import { createHash } from "node:crypto";

import type { Db } from "@mandate/db";
import { PublicKey } from "@solana/web3.js";

/**
 * SYNTHETIC LOAD DATA. TEST ONLY.
 *
 * These rows are fabricated to exercise read paths and worker scheduling at scale. They never come from, and must
 * never be shown as, chain state. Every synthetic address is derived from the label "SYNTHETIC-TEST-FIXTURE", so the
 * data is recognisable, deterministic and cannot collide with a real account.
 */
export const SYNTHETIC_LABEL = "SYNTHETIC-TEST-FIXTURE";

/** Deterministic, valid base58 public key number `i` in namespace `ns`. */
export function syntheticKey(ns: string, i: number): string {
  const digest = createHash("sha256").update(`${SYNTHETIC_LABEL}:${ns}:${i.toString()}`).digest();
  return new PublicKey(digest).toBase58();
}

export interface SyntheticOptions {
  readonly mandates: number;
  readonly epochsEach: number;
  readonly observers?: number;
  readonly markets?: number;
  readonly epochSeconds?: number;
  /** Mandates start `startOffsetSeconds` before `nowUnix`, so many epochs are already due. */
  readonly nowUnix: number;
  readonly startOffsetSeconds: number;
  /** Fraction (0..1) of due epochs that already have a finalized result. */
  readonly resolvedFraction?: number;
}

export interface SyntheticWorld {
  readonly observers: string[];
  readonly markets: string[];
  readonly pools: string[];
  readonly mandates: string[];
  readonly providers: string[];
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Bulk-insert a synthetic read model: observer set, markets, mandates, bids, attestations and results. */
export async function seedSynthetic(db: Db, o: SyntheticOptions): Promise<SyntheticWorld> {
  const epochSeconds = o.epochSeconds ?? 300;
  const observerCount = o.observers ?? 3;
  const marketCount = o.markets ?? 5;
  const resolved = o.resolvedFraction ?? 0.5;
  const start = o.nowUnix - o.startOffsetSeconds;
  const observers = Array.from({ length: observerCount }, (_, i) => syntheticKey("observer", i));
  const setAddress = syntheticKey("observer-set", 1);
  const markets = Array.from({ length: marketCount }, (_, i) => syntheticKey("market", i));
  const pools = Array.from({ length: marketCount }, (_, i) => syntheticKey("pool", i));
  const mandates = Array.from({ length: o.mandates }, (_, i) => syntheticKey("mandate", i));
  const providers = Array.from({ length: Math.max(1, Math.ceil(o.mandates / 5)) }, (_, i) =>
    syntheticKey("provider", i),
  );

  await db.query("INSERT INTO observer_sets (address, version, slot, data) VALUES ($1,1,1,$2)", [
    setAddress,
    JSON.stringify({
      version: 1,
      observerCount,
      threshold: 2,
      observers,
      synthetic: SYNTHETIC_LABEL,
    }),
  ]);
  await db.query(
    `INSERT INTO markets (address, pool, enabled, slot, data)
     SELECT r.address, r.pool, true, 1, jsonb_build_object('pool', r.pool, 'enabled', true, 'synthetic', $2::text)
     FROM jsonb_to_recordset($1::jsonb) AS r(address text, pool text)`,
    [JSON.stringify(markets.map((address, i) => ({ address, pool: pools[i] }))), SYNTHETIC_LABEL],
  );

  const mandateRows = mandates.map((address, i) => ({
    address,
    provider: providers[i % providers.length],
    market: markets[i % marketCount],
    status: i % 10 === 0 ? "Bidding" : "Active",
    data: {
      sponsor: syntheticKey("sponsor", i % 50),
      provider: providers[i % providers.length],
      marketConfig: markets[i % marketCount],
      status: i % 10 === 0 ? "Bidding" : "Active",
      startAt: String(start),
      endAt: String(start + o.epochsEach * epochSeconds),
      totalEpochs: o.epochsEach,
      finalizedEpochs: 0,
      compliantEpochs: 0,
      noncompliantEpochs: 0,
      unavailableEpochs: 0,
      maxRewardRaw: "1000000000",
      acceptedRewardRaw: "900000000",
      earnedRewardRaw: "0",
      forfeitedRewardRaw: "0",
      claimedRewardRaw: "0",
      sponsorWithdrawnRaw: "0",
      epochSeconds: String(epochSeconds),
      observerSet: setAddress,
      unavailableRecoverySeconds: "3600",
      vault: syntheticKey("vault", i),
      probeQuoteRaw: "10000000",
      depthBandBps: 500,
      algorithmVersion: 1,
      synthetic: SYNTHETIC_LABEL,
    },
  }));
  for (const part of chunk(mandateRows, 500)) {
    await db.query(
      `INSERT INTO mandates (address, sponsor, provider, market_config, status, start_at, end_at, total_epochs,
         finalized_epochs, max_reward_raw, earned_raw, claimed_raw, slot, data)
       SELECT r.address, r.data->>'sponsor', r.provider, r.market, r.status, (r.data->>'startAt')::bigint,
         (r.data->>'endAt')::bigint, (r.data->>'totalEpochs')::int, 0, 1000000000, 0, 0, 1, r.data
       FROM jsonb_to_recordset($1::jsonb) AS r(address text, provider text, market text, status text, data jsonb)`,
      [JSON.stringify(part)],
    );
  }

  const bidRows = mandates.flatMap((mandate, i) =>
    [0, 1, 2].map((n) => ({
      address: syntheticKey("bid", i * 3 + n),
      mandate,
      provider: providers[(i + n) % providers.length],
      data: {
        mandate,
        provider: providers[(i + n) % providers.length],
        status: "Active",
        createdAt: String(start + n),
        requestedRewardRaw: "900000000",
        synthetic: SYNTHETIC_LABEL,
      },
    })),
  );
  for (const part of chunk(bidRows, 1000)) {
    await db.query(
      `INSERT INTO bids (address, mandate, provider, status, slot, data)
       SELECT r.address, r.mandate, r.provider, 'Active', 1, r.data
       FROM jsonb_to_recordset($1::jsonb) AS r(address text, mandate text, provider text, data jsonb)`,
      [JSON.stringify(part)],
    );
  }

  const dueEpochs = Math.min(o.epochsEach, Math.floor(o.startOffsetSeconds / epochSeconds));
  const resultRows: unknown[] = [];
  for (const [i, mandate] of mandates.entries()) {
    if (i % 10 === 0) continue;
    for (let e = 0; e < dueEpochs; e++) {
      if ((e * 7 + i) % 100 >= resolved * 100) continue;
      resultRows.push({
        address: syntheticKey("result", i * o.epochsEach + e),
        mandate,
        epochIndex: e,
        data: {
          mandate,
          epochIndex: e,
          outcome: "Compliant",
          rewardEarnedRaw: "12500000",
          evidenceHash: "ee".repeat(32),
          payloadHash: "aa".repeat(32),
          observedUnixTs: String(start + (e + 1) * epochSeconds - 1),
          metrics: {},
          synthetic: SYNTHETIC_LABEL,
        },
      });
    }
  }
  for (const part of chunk(resultRows, 1000)) {
    await db.query(
      `INSERT INTO epoch_results (address, mandate, epoch_index, outcome, reward_earned_raw, evidence_hash, slot, data)
       SELECT r.address, r.mandate, r."epochIndex", 'Compliant', 12500000, 'ee', 1, r.data
       FROM jsonb_to_recordset($1::jsonb) AS r(address text, mandate text, "epochIndex" int, data jsonb)`,
      [JSON.stringify(part)],
    );
  }
  return { observers, markets, pools, mandates, providers };
}
