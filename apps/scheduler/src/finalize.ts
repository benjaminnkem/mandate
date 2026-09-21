import type { Outcome } from "@mandate/db";
import {
  finalizeEpoch,
  finalizeUnavailableEpoch,
  findAttestationPda,
  findPositionSetPda,
  type EpochAttestationAccount,
  type MandateAccount,
} from "@mandate/solana";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface FinalizePorts {
  now(): Date;
  loadMandate(mandate: PublicKey): Promise<MandateAccount | null>;
  loadObserverSet(
    address: PublicKey,
  ): Promise<{ observers: readonly PublicKey[]; threshold: number }>;
  epochResultExists(mandate: PublicKey, epoch: number): Promise<boolean>;
  /** Attestations that exist on chain for this epoch, keyed by observer base58. */
  loadAttestations(
    mandate: PublicKey,
    epoch: number,
    observers: readonly PublicKey[],
  ): Promise<Map<string, EpochAttestationAccount>>;
  /** Sign with the relayer (fee payer only) and send; resolves with the signature once confirmed. */
  submit(ix: TransactionInstruction): Promise<string>;
  /** The relayer's public key, the transaction fee payer. */
  readonly payer: PublicKey;
}

const hex = (bytes: readonly number[] | Uint8Array): string => Buffer.from(bytes).toString("hex");

/** Everything attestations must agree on, as one comparable string. */
function factsKey(a: EpochAttestationAccount): string {
  return JSON.stringify([
    a.observedSlot.toString(),
    a.observedUnixTs.toString(),
    a.algorithmVersion,
    a.positionSet.toBase58(),
    hex(a.payloadHash),
    hex(a.evidenceHash),
    a.metrics.effectiveSpreadBps,
    a.metrics.poolBuyDepthQuoteRaw.toString(),
    a.metrics.poolSellDepthQuoteRaw.toString(),
    a.metrics.providerQuoteInBandRaw.toString(),
    a.metrics.providerBaseQuoteEqInBandRaw.toString(),
  ]);
}

export interface FinalizeOptions {
  /** How often to re-check for a quorum while an epoch waits for its observers. */
  readonly pollSeconds: number;
}

/**
 * Finalize one epoch exactly once. Order of checks makes it safe to run at any time, from any number of workers:
 *   1. an EpochResult already exists: done (someone else finalized; nothing to send);
 *   2. the epoch has not ended: wait;
 *   3. a threshold of attestations agree exactly: send `finalize_epoch` with exactly those attestations;
 *   4. no quorum before the recovery deadline: wait (waiting is not failure);
 *   5. no quorum at the deadline: send `finalize_unavailable_epoch`.
 * If a send fails, re-read the chain: if the result now exists the failure was a lost race, not an error.
 */
export async function finalizeJob(
  ports: FinalizePorts,
  target: { mandate: PublicKey; epoch: number },
  options: FinalizeOptions,
): Promise<Outcome> {
  const { mandate, epoch } = target;
  if (await ports.epochResultExists(mandate, epoch)) return "done";
  const m = await ports.loadMandate(mandate);
  if (!m) return { fatal: `mandate ${mandate.toBase58()} does not exist` };
  if (m.status !== "Active") return "done"; // nothing can be finalized on a mandate that is not running

  const epochSeconds = Number(m.epochSeconds);
  const epochEndMs = (Number(m.startAt) + (epoch + 1) * epochSeconds) * 1000;
  const deadlineMs = epochEndMs + Number(m.unavailableRecoverySeconds) * 1000;
  const now = ports.now();
  if (now.getTime() < epochEndMs)
    return { deferUntil: new Date(epochEndMs), reason: "epoch has not ended" };

  const set = await ports.loadObserverSet(m.observerSet);
  const found = await ports.loadAttestations(mandate, epoch, set.observers);
  const groups = new Map<string, EpochAttestationAccount[]>();
  for (const a of found.values()) {
    const list = groups.get(factsKey(a)) ?? [];
    list.push(a);
    groups.set(factsKey(a), list);
  }
  const quorums = [...groups.values()].filter((g) => g.length >= set.threshold);
  if (quorums.length > 1)
    return {
      fatal: `${quorums.length} conflicting quorums for ${mandate.toBase58()} epoch ${epoch}; needs an operator`,
    };

  const positionSet = findPositionSetPda(mandate);
  let ix: TransactionInstruction;
  const quorum = quorums[0];
  if (quorum) {
    ix = finalizeEpoch({
      payer: ports.payer,
      mandate,
      observerSet: m.observerSet,
      positionSet,
      epochIndex: epoch,
      attestations: quorum.map((a) => findAttestationPda(mandate, epoch, a.observer)),
    });
  } else if (now.getTime() < deadlineMs) {
    const next = Math.min(now.getTime() + options.pollSeconds * 1000, deadlineMs);
    return {
      deferUntil: new Date(next),
      reason: `waiting for a quorum (${found.size}/${set.threshold} attested)`,
    };
  } else {
    ix = finalizeUnavailableEpoch({ payer: ports.payer, mandate, epochIndex: epoch });
  }

  try {
    await ports.submit(ix);
    return "done";
  } catch (error) {
    if (await ports.epochResultExists(mandate, epoch)) return "done"; // lost a race to another finalizer
    throw error;
  }
}
