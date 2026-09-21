import { readFileSync } from "node:fs";
import { Writable } from "node:stream";

import { replayPool, type AccountSnapshot, type PoolObservation } from "@mandate/meteora";
import { createLogger } from "@mandate/observability";
import type { MandateAccount } from "@mandate/solana";
import { Keypair, PublicKey } from "@solana/web3.js";

import { AttestationExistsError } from "../src/errors.ts";
import type { JobConfig, MeasureParams, Measurer } from "../src/job.ts";
import type { ChainPort, MandateContext, OnchainAttestation, SubmitInput } from "../src/ports.ts";

// REAL mainnet-beta account state captured at one slot (packages/meteora/test/fixtures/README.md).
export const snapshot = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/meteora/test/fixtures/openai-usdc-mainnet.snapshot.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as AccountSnapshot;

export const POOL = "4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH";
export const BASE = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const PROVIDER = "2KmmUnQ6nscD7j6siUjZMbDoT1u6jnjfZWF386CcRjak";
export const POSITIONS = [
  "2Ymo1bMvEQsTcErk5tEEYRZ8kKG5wNCRBbWvP8YnixNU",
  "7UXQYfYALyUDKQPaPSTj7kuRdbPyc3oNkxyVtTEFqjhR",
  "B8BhNDnc6HePLdjn6grmYpoM7AiCsKzQqVjbtrpSztdE",
  "3gRmvT4D9viEtEbFo4QDnDk7THnTXaLstYFBoffkc1qn",
  "Fz1XcAr1fxKcJZsJpHfj8sXpXnBz5L9m6z3Zy1xq2vQp",
];

// The snapshot's on-chain clock is 1789921836. Epochs of 300s starting at 1789921200: epoch 2 covers
// [1789921800, 1789922100), which contains it.
export const START = 1_789_921_200;
export const EPOCH_SECONDS = 300;
export const EPOCH = 2;
export const EPOCH_START = START + EPOCH * EPOCH_SECONDS;
export const EPOCH_END = EPOCH_START + EPOCH_SECONDS;
export const RECOVERY = 3_600;
export const OBSERVE_AT = EPOCH_END - 60; // primary leader acts here (lead 60s, timeout 15s)

export const MANDATE_ADDRESS = "Mand1111111111111111111111111111111111111111"
  .replace(/1/g, "2")
  .slice(0, 44);

export const timing = { observeLeadSeconds: 60, leaderTimeoutSeconds: 15 };
export const provenance = { algorithmSourceCommit: "TEST-COMMIT", lockfileSha256: "0".repeat(64) };
export const config = (instanceId: string, over: Partial<JobConfig> = {}): JobConfig => ({
  timing,
  provenance,
  cluster: "mainnet-beta",
  instanceId,
  ...over,
});

export function newObservers(n = 3): Keypair[] {
  return Array.from({ length: n }, () => Keypair.generate());
}

export function mandateAccount(over: Partial<MandateAccount> = {}): MandateAccount {
  const k = (n: number): PublicKey => new PublicKey(new Uint8Array(32).fill(n));
  return {
    sponsor: k(1),
    mandateId: 1n,
    marketConfig: k(2),
    observerSet: k(3),
    vault: k(4),
    startAt: BigInt(START),
    epochSeconds: BigInt(EPOCH_SECONDS),
    totalEpochs: 72,
    endAt: BigInt(START + 72 * EPOCH_SECONDS),
    algorithmVersion: 1,
    unavailableRecoverySeconds: BigInt(RECOVERY),
    depthBandBps: 500,
    probeQuoteRaw: 10_000_000n,
    maxEffectiveSpreadBps: 400,
    minPoolBuyDepthQuoteRaw: 1n,
    minPoolSellDepthQuoteRaw: 1n,
    minProviderQuoteInBandRaw: 1n,
    minProviderBaseQuoteEqInBandRaw: 1n,
    provider: new PublicKey(PROVIDER),
    positionSet: k(5),
    finalizedEpochs: 0,
    status: "Active",
    ...over,
  };
}

/** One chain shared by several observer ports; mirrors the program's `submit_attestation` rules. */
export class World {
  now = OBSERVE_AT;
  readonly attestations = new Map<string, OnchainAttestation>();
  readonly submits: SubmitInput[] = [];
  onSubmit: ((input: SubmitInput, observer: string) => void) | undefined;
  mandate: MandateAccount = mandateAccount();

  readonly observers: readonly string[];

  constructor(observers: readonly string[]) {
    this.observers = observers;
  }

  context(): MandateContext {
    return {
      mandateAddress: MANDATE_ADDRESS,
      mandate: this.mandate,
      observerSetAddress: this.mandate.observerSet.toBase58(),
      observers: this.observers,
      threshold: 2,
      positionSetAddress: this.mandate.positionSet.toBase58(),
      positions: POSITIONS,
      market: { pool: POOL, baseMint: BASE, quoteMint: USDC },
    };
  }

  port(observer: string): ChainPort {
    return {
      observer,
      nowUnix: () => Promise.resolve(this.now),
      loadContext: () => Promise.resolve(this.context()),
      loadAttestations: (_m, epoch, observers) =>
        Promise.resolve(
          new Map(
            observers.flatMap((o) => {
              const a = this.attestations.get(`${String(epoch)}:${o}`);
              return a ? ([[o, a]] as const) : [];
            }),
          ),
        ),
      submitAttestation: (input) => {
        this.onSubmit?.(input, observer);
        this.submits.push(input);
        const key = `${String(input.epochIndex)}:${observer}`;
        if (this.attestations.has(key))
          return Promise.reject(new AttestationExistsError("already in use"));
        if (!this.observers.includes(observer))
          return Promise.reject(new Error("ObserverNotInSet"));
        if (
          input.observedUnixTs < BigInt(EPOCH_START) ||
          input.observedUnixTs >= BigInt(EPOCH_END)
        ) {
          return Promise.reject(new Error("ObservationOutsideEpoch"));
        }
        this.attestations.set(key, {
          observer,
          observedSlot: input.observedSlot,
          observedUnixTs: input.observedUnixTs,
          algorithmVersion: input.algorithmVersion,
          positionSet: input.positionSetAddress,
          payloadHash: input.payloadHash,
          evidenceHash: input.evidenceHash,
          metrics: input.metrics,
        });
        return Promise.resolve({
          signature: `sig-${observer.slice(0, 6)}-${String(this.submits.length)}`,
        });
      },
    };
  }
}

/** "Live chain" for tests: the recorded real snapshot. `mutate` lets a test make live state drift from it. */
export function fixtureMeasurer(
  mutate?: (o: PoolObservation) => PoolObservation,
): Measurer & { liveCalls: number } {
  const m = {
    liveCalls: 0,
    rpcHost: "rpc.test.invalid",
    async observeLive(p: MeasureParams): Promise<PoolObservation> {
      m.liveCalls += 1;
      const o = await replayPool(snapshot, p);
      return mutate ? mutate(o) : o;
    },
    replay: (s: AccountSnapshot, p: MeasureParams): Promise<PoolObservation> => replayPool(s, p),
  };
  return m;
}

export function spyLogger(): {
  logger: ReturnType<typeof createLogger>;
  errors: () => Record<string, unknown>[];
} {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return {
    logger: createLogger({ service: "test", level: "info", destination: stream }),
    errors: () =>
      lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((l) => (l["level"] as number) >= 50),
  };
}
