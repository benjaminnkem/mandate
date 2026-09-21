import {
  buildEvidence,
  canonicalJson,
  type AccountSnapshot,
  type EvidenceBundle,
  type PoolObservation,
  type Provenance,
} from "@mandate/meteora";
import { epochBounds } from "@mandate/domain";
import type { Logger } from "@mandate/observability";

import { AttestationConflictError, AttestationExistsError } from "./errors.ts";
import type { EvidenceRecord, EvidenceStore } from "./evidence-store.ts";
import { leaderActsAt, leaderOrder, leaderRank, timingFits, type LeaderTiming } from "./leader.ts";
import {
  bytesToHex,
  type ChainPort,
  type MandateContext,
  type OnchainAttestation,
} from "./ports.ts";
import { DEFAULT_TOLERANCE, checkSnapshotPlausibility, type SanityTolerance } from "./sanity.ts";

export interface MeasureParams {
  readonly pool: string;
  readonly baseMint: string;
  readonly quoteMint: string;
  readonly provider: string;
  readonly positions: readonly string[];
  readonly probeQuoteRaw: bigint;
  readonly depthBandBps: bigint;
}

/** The measurement engine, injected so the job can be tested with recorded real state and no network. */
export interface Measurer {
  /** Observe the live chain as one atomic snapshot. */
  observeLive(params: MeasureParams): Promise<PoolObservation>;
  /** Reproduce an observation from a stored snapshot, offline. */
  replay(snapshot: AccountSnapshot, params: MeasureParams): Promise<PoolObservation>;
  /** Where measurements are read from, for evidence transport metadata only. */
  readonly rpcHost: string | null;
}

export interface JobConfig {
  readonly timing: LeaderTiming;
  readonly tolerance?: SanityTolerance;
  readonly provenance: Provenance;
  readonly cluster: string;
  readonly instanceId: string;
}

export interface JobDeps {
  /** Called once per epoch job in which two or more OTHER observers' payload hashes disagree. */
  onDisagreement?: () => void;
  readonly chain: ChainPort;
  readonly store: EvidenceStore;
  readonly measurer: Measurer;
  readonly logger: Logger;
  readonly config: JobConfig;
}

export type JobResult =
  | { readonly status: "mandate-not-active" }
  | { readonly status: "epoch-out-of-range" }
  | { readonly status: "too-early"; readonly actsAt: number }
  | { readonly status: "window-closed" }
  | { readonly status: "waiting-for-leader"; readonly actsAt: number; readonly rank: number }
  | {
      readonly status: "already-attested";
      readonly payloadHash: string;
      readonly localEvidence: boolean;
    }
  | { readonly status: "observation-outside-epoch"; readonly observedUnixTs: bigint }
  | { readonly status: "cannot-verify"; readonly reasons: readonly string[] }
  | {
      readonly status: "attested";
      readonly role: "leader" | "follower";
      readonly signature: string;
      readonly payloadHash: string;
      readonly evidenceHash: string;
    };

const measureParams = (ctx: MandateContext): MeasureParams => ({
  pool: ctx.market.pool,
  baseMint: ctx.market.baseMint,
  quoteMint: ctx.market.quoteMint,
  provider: ctx.mandate.provider.toBase58(),
  positions: ctx.positions,
  probeQuoteRaw: ctx.mandate.probeQuoteRaw,
  depthBandBps: BigInt(ctx.mandate.depthBandBps),
});

const metricsAsStrings = (m: EvidenceBundle["metrics"]): Record<string, string> => ({
  effectiveSpreadBps: String(m.effectiveSpreadBps),
  poolBuyDepthQuoteRaw: m.poolBuyDepthQuoteRaw.toString(),
  poolSellDepthQuoteRaw: m.poolSellDepthQuoteRaw.toString(),
  providerQuoteInBandRaw: m.providerQuoteInBandRaw.toString(),
  providerBaseQuoteEqInBandRaw: m.providerBaseQuoteEqInBandRaw.toString(),
});

function sameMetrics(a: EvidenceBundle["metrics"], b: OnchainAttestation["metrics"]): boolean {
  return (
    a.effectiveSpreadBps === b.effectiveSpreadBps &&
    a.poolBuyDepthQuoteRaw === b.poolBuyDepthQuoteRaw &&
    a.poolSellDepthQuoteRaw === b.poolSellDepthQuoteRaw &&
    a.providerQuoteInBandRaw === b.providerQuoteInBandRaw &&
    a.providerBaseQuoteEqInBandRaw === b.providerBaseQuoteEqInBandRaw
  );
}

/**
 * One observer's work for one (mandate, epoch). Deterministic in its inputs, safe to run repeatedly:
 *
 *  - if this observer already attested, verify the chain matches its stored evidence (loud failure if not) and stop;
 *  - if another observer already attested, act as a FOLLOWER: fetch their snapshot, replay it, and sign only if
 *    this observer's own computation reproduces their payload hash, evidence hash and metrics exactly;
 *  - otherwise act as LEADER once this observer's turn in the epoch's rotation arrives: observe the live pool,
 *    persist the snapshot and evidence durably, then submit.
 * Evidence is always persisted before the attestation is submitted.
 */
export async function runEpochJob(
  deps: JobDeps,
  input: { mandate: string; epochIndex: number },
): Promise<JobResult> {
  const { chain, store, measurer, logger, config } = deps;
  const me = chain.observer;
  const ctx = await chain.loadContext(input.mandate);
  const m = ctx.mandate;

  if (m.status !== "Active" && m.status !== "AwaitingFinalization")
    return { status: "mandate-not-active" };
  if (
    !Number.isSafeInteger(input.epochIndex) ||
    input.epochIndex < 0 ||
    input.epochIndex >= m.totalEpochs
  ) {
    return { status: "epoch-out-of-range" };
  }
  if (!ctx.observers.includes(me))
    throw new RangeError("this observer's key is not in the mandate's observer set");
  if (!timingFits(ctx.observers.length, config.timing)) {
    throw new RangeError(
      "leader timing does not fit the observer count: the last rank would act after the epoch ends",
    );
  }

  const bounds = epochBounds(m, input.epochIndex, m.unavailableRecoverySeconds);
  const epochEnd = Number(bounds.epochEnd);
  const now = await chain.nowUnix();
  const observeAt = leaderActsAt(epochEnd, 0, config.timing);
  if (now < observeAt) return { status: "too-early", actsAt: observeAt };
  if (BigInt(now) >= bounds.recoveryDeadline) return { status: "window-closed" };

  const onchain = await chain.loadAttestations(input.mandate, input.epochIndex, ctx.observers);

  // 1. Already attested by me: verify, never re-submit.
  const mine = onchain.get(me);
  if (mine) {
    const record = await store.getOwnRecord(input.mandate, input.epochIndex, me);
    if (!record) {
      logger.error(
        { mandate: input.mandate, epoch: input.epochIndex },
        "attestation exists on chain but this observer has no local evidence for it",
      );
      return { status: "already-attested", payloadHash: mine.payloadHash, localEvidence: false };
    }
    if (record.payloadHash !== mine.payloadHash || record.evidenceHash !== mine.evidenceHash) {
      throw new AttestationConflictError(
        `on-chain attestation (${mine.payloadHash}) conflicts with this observer's stored evidence (${record.payloadHash}) for epoch ${String(input.epochIndex)}`,
      );
    }
    return { status: "already-attested", payloadHash: mine.payloadHash, localEvidence: true };
  }

  // Disagreement among others is an alert, never something to average away.
  const others = leaderOrder(input.epochIndex, ctx.observers)
    .filter((o) => o !== me)
    .flatMap((o) => {
      const a = onchain.get(o);
      return a ? [a] : [];
    });
  if (new Set(others.map((a) => a.payloadHash)).size > 1) {
    deps.onDisagreement?.();
    logger.error(
      {
        mandate: input.mandate,
        epoch: input.epochIndex,
        payloadHashes: others.map((a) => [a.observer, a.payloadHash]),
      },
      "observers disagree on this epoch: no quorum is possible until they converge",
    );
  }

  const params = measureParams(ctx);
  const evidenceContext = {
    cluster: config.cluster,
    mandate: input.mandate,
    epochIndex: input.epochIndex,
    positionSet: ctx.positionSetAddress,
  };
  const inputs = { probeQuoteRaw: params.probeQuoteRaw, depthBandBps: params.depthBandBps };
  const transport = { observerInstanceId: config.instanceId, rpcHost: measurer.rpcHost };

  // 2. Someone attested first: follow.
  if (others.length > 0) {
    const reasons: string[] = [];
    for (const leader of others) {
      const result = await tryFollow(
        deps,
        ctx,
        input.epochIndex,
        leader,
        params,
        evidenceContext,
        inputs,
        transport,
        bounds,
        reasons,
      );
      if (result) return result;
    }
    logger.error(
      { mandate: input.mandate, epoch: input.epochIndex, reasons },
      "cannot verify any existing attestation: not signing",
    );
    return { status: "cannot-verify", reasons };
  }

  // 3. Nobody attested yet: lead when this observer's turn arrives.
  const rank = leaderRank(input.epochIndex, ctx.observers, me);
  const actsAt = leaderActsAt(epochEnd, rank, config.timing);
  if (now < actsAt) return { status: "waiting-for-leader", actsAt, rank };

  const observation = await measurer.observeLive(params);
  const bundle = buildEvidence(observation, evidenceContext, config.provenance, inputs, transport);
  if (bundle.observedUnixTs < bounds.epochStart || bundle.observedUnixTs >= bounds.epochEnd) {
    logger.error(
      { observedUnixTs: bundle.observedUnixTs.toString(), epoch: input.epochIndex },
      "live observation falls outside the epoch: not attesting",
    );
    return { status: "observation-outside-epoch", observedUnixTs: bundle.observedUnixTs };
  }
  return persistAndSubmit(deps, ctx, input.epochIndex, "leader", observation, bundle);
}

async function tryFollow(
  deps: JobDeps,
  ctx: MandateContext,
  epochIndex: number,
  leader: OnchainAttestation,
  params: MeasureParams,
  evidenceContext: Parameters<typeof buildEvidence>[1],
  inputs: Parameters<typeof buildEvidence>[3],
  transport: Parameters<typeof buildEvidence>[4],
  bounds: { epochStart: bigint; epochEnd: bigint },
  reasons: string[],
): Promise<JobResult | null> {
  const { store, measurer, logger, config } = deps;
  const tag = `leader ${leader.observer}`;
  const record =
    (await store.getRecord(leader.evidenceHash, leader.observer)) ??
    (await store.getAnyRecord(leader.evidenceHash));
  if (!record) {
    reasons.push(`${tag}: no evidence record for ${leader.evidenceHash} is available`);
    return null;
  }
  const snapshot = await store.getSnapshot(record.snapshotSha256).catch((error: unknown) => {
    reasons.push(`${tag}: ${(error as Error).message}`);
    return null;
  });
  if (!snapshot) {
    reasons.push(`${tag}: snapshot ${record.snapshotSha256} is unavailable or corrupted`);
    return null;
  }

  const replayed = await measurer.replay(snapshot, params).catch((error: unknown) => {
    reasons.push(`${tag}: the snapshot could not be replayed (${(error as Error).message})`);
    return null;
  });
  if (!replayed) return null;
  const bundle = buildEvidence(replayed, evidenceContext, config.provenance, inputs, transport);

  if (bundle.payloadHash !== leader.payloadHash || bundle.evidenceHash !== leader.evidenceHash) {
    reasons.push(
      `${tag}: replaying their snapshot does not reproduce their hashes (mine ${bundle.payloadHash}, theirs ${leader.payloadHash})`,
    );
    return null;
  }
  if (
    !sameMetrics(bundle.metrics, leader.metrics) ||
    bundle.observedSlot !== leader.observedSlot ||
    bundle.observedUnixTs !== leader.observedUnixTs
  ) {
    reasons.push(`${tag}: replayed metrics/slot/time differ from what they attested`);
    return null;
  }
  if (bundle.observedUnixTs < bounds.epochStart || bundle.observedUnixTs >= bounds.epochEnd) {
    reasons.push(`${tag}: their observation lies outside the epoch`);
    return null;
  }

  // Plausibility against the live chain this observer can see for itself.
  const live = await measurer.observeLive(params).catch((error: unknown) => {
    reasons.push(
      `${tag}: could not read the live chain to sanity-check the snapshot (${(error as Error).message})`,
    );
    return null;
  });
  if (!live) return null;
  const problems = checkSnapshotPlausibility(replayed, live, config.tolerance ?? DEFAULT_TOLERANCE);
  if (problems.length > 0) {
    reasons.push(...problems.map((p) => `${tag}: ${p}`));
    return null;
  }

  logger.info(
    { epoch: epochIndex, leader: leader.observer },
    "leader's snapshot reproduced exactly and is plausible: following",
  );
  return persistAndSubmit(deps, ctx, epochIndex, "follower", replayed, bundle);
}

async function persistAndSubmit(
  deps: JobDeps,
  ctx: MandateContext,
  epochIndex: number,
  role: "leader" | "follower",
  observation: PoolObservation,
  bundle: EvidenceBundle,
): Promise<JobResult> {
  const { chain, store, logger } = deps;
  const me = chain.observer;

  // Durable evidence FIRST: snapshot, then record. Only then is anything sent to the chain.
  const snapshotSha256 = await store.putSnapshot(observation.snapshot);
  if (snapshotSha256 !== bundle.snapshotSha256)
    throw new Error("snapshot hash disagrees between the store and the evidence bundle");
  const record: EvidenceRecord = {
    schema: "mandate-evidence-record",
    version: 1,
    mandate: ctx.mandateAddress,
    epochIndex,
    observer: me,
    role,
    payloadJson: canonicalJson(bundle.payload),
    payloadHash: bundle.payloadHash,
    snapshotSha256,
    evidenceHash: bundle.evidenceHash,
    transportJson: canonicalJson(bundle.transport),
    observedSlot: bundle.observedSlot.toString(),
    observedUnixTs: bundle.observedUnixTs.toString(),
    algorithmVersion: ctx.mandate.algorithmVersion,
    metrics: metricsAsStrings(bundle.metrics),
  };
  await store.putRecord(record);

  try {
    const { signature } = await chain.submitAttestation({
      mandateAddress: ctx.mandateAddress,
      observerSetAddress: ctx.observerSetAddress,
      positionSetAddress: ctx.positionSetAddress,
      epochIndex,
      observedSlot: bundle.observedSlot,
      observedUnixTs: bundle.observedUnixTs,
      algorithmVersion: ctx.mandate.algorithmVersion,
      payloadHash: bundle.payloadHash,
      evidenceHash: bundle.evidenceHash,
      metrics: bundle.metrics,
    });
    logger.info(
      { epoch: epochIndex, role, signature, payloadHash: bundle.payloadHash },
      "attestation submitted",
    );
    return {
      status: "attested",
      role,
      signature,
      payloadHash: bundle.payloadHash,
      evidenceHash: bundle.evidenceHash,
    };
  } catch (error) {
    if (!(error instanceof AttestationExistsError)) throw error;
    // Lost a race with our own earlier submission (e.g. a crash after sending): compare with the chain.
    const existing = (await chain.loadAttestations(ctx.mandateAddress, epochIndex, [me])).get(me);
    if (
      existing?.payloadHash === bundle.payloadHash &&
      existing.evidenceHash === bundle.evidenceHash
    ) {
      return { status: "already-attested", payloadHash: bundle.payloadHash, localEvidence: true };
    }
    throw new AttestationConflictError(
      `an attestation by this observer already exists for epoch ${String(epochIndex)} and differs from the one just computed (chain ${existing?.payloadHash ?? "unreadable"}, computed ${bundle.payloadHash})`,
    );
  }
}

export { bytesToHex };
