import { claim, migrate, queueStats, upsertAccount, type Db, type Outcome } from "@mandate/db";
import { createTestDb } from "@mandate/db/testing";
import type { EpochAttestationAccount, MandateAccount } from "@mandate/solana";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { finalizeJob, type FinalizePorts } from "../src/finalize.ts";
import { planJobs } from "../src/planner.ts";

const k = (n: number): PublicKey => new PublicKey(new Uint8Array(32).fill(n));
const OBS = [k(31), k(32), k(33)];
const MANDATE = k(50);
const START = 1_000_000;
const ES = 300;
const RECOVERY = 3600;
const endOf = (epoch: number): number => START + (epoch + 1) * ES;

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

async function seedMandate(
  address: PublicKey,
  over: { status?: string; epochs?: number } = {},
): Promise<void> {
  await upsertAccount(db, "ObserverSet", k(60).toBase58(), 1n, {
    version: 1,
    observerCount: 3,
    threshold: 2,
    observers: OBS.map((o) => o.toBase58()),
  });
  await upsertAccount(db, "Mandate", address.toBase58(), 1n, {
    sponsor: k(1).toBase58(),
    provider: k(9).toBase58(),
    marketConfig: k(2).toBase58(),
    status: over.status ?? "Active",
    startAt: String(START),
    endAt: String(START + (over.epochs ?? 6) * ES),
    totalEpochs: over.epochs ?? 6,
    finalizedEpochs: 0,
    maxRewardRaw: "100",
    earnedRewardRaw: "0",
    claimedRewardRaw: "0",
    epochSeconds: String(ES),
    observerSet: k(60).toBase58(),
    unavailableRecoverySeconds: String(RECOVERY),
  });
}
const at = (unix: number): Date => new Date(unix * 1000);
const cfg = { lookaheadSeconds: 120, observeLeadSeconds: 60 };

describe("planner", () => {
  it("plans each epoch once: one finalize job plus one observe job per observer, owned by that observer", async () => {
    await seedMandate(MANDATE);
    const now = at(endOf(1) - 100); // epochs 0 and 1 end within the 120s lookahead
    const r = await planJobs(db, now, cfg);
    expect(r).toEqual({ epochsPlanned: 2, jobsCreated: 8 });
    const jobs = await db.query<{ key: string; kind: string; owner: string | null }>(
      "SELECT key, kind, owner FROM jobs ORDER BY key",
    );
    expect(
      jobs.rows
        .filter((j) => j.kind === "observe")
        .every((j) => OBS.some((o) => j.key.endsWith(o.toBase58()) && j.owner === o.toBase58())),
    ).toBe(true);
    expect(jobs.rows.filter((j) => j.kind === "finalize").map((j) => j.key)).toEqual([
      `finalize:${MANDATE.toBase58()}:0`,
      `finalize:${MANDATE.toBase58()}:1`,
    ]);
  });

  it("is idempotent across repeated and concurrent passes", async () => {
    await seedMandate(MANDATE);
    const now = at(endOf(3));
    await Promise.all([planJobs(db, now, cfg), planJobs(db, now, cfg), planJobs(db, now, cfg)]);
    await planJobs(db, now, cfg);
    const stats = await queueStats(db);
    expect(stats.byKind["finalize"]?.queued).toBe(4);
    expect(stats.byKind["observe"]?.queued).toBe(12);
    expect((await planJobs(db, now, cfg)).jobsCreated).toBe(0);
  });

  it("skips epochs that already have a result, inactive mandates, and epochs beyond the lookahead", async () => {
    await seedMandate(MANDATE);
    await upsertAccount(db, "EpochResult", k(70).toBase58(), 1n, {
      mandate: MANDATE.toBase58(),
      epochIndex: 0,
      outcome: "Compliant",
      rewardEarnedRaw: "1",
      evidenceHash: "aa",
    });
    await seedMandate(k(51), { status: "Bidding" });
    const r = await planJobs(db, at(endOf(1) - 100), cfg);
    expect(r.epochsPlanned).toBe(1); // only epoch 1 of the active mandate
    const before = at(START - 1000);
    expect((await planJobs(db, before, cfg)).epochsPlanned).toBe(0);
  });

  it("never plans past the mandate's last epoch", async () => {
    await seedMandate(MANDATE, { epochs: 2 });
    const r = await planJobs(db, at(START + 100 * ES), cfg);
    expect(r.epochsPlanned).toBe(2);
  });

  it("gives observe jobs to the observers only, leaving finalize claimable by anyone", async () => {
    await seedMandate(MANDATE);
    await planJobs(db, at(endOf(0)), cfg);
    const t = at(endOf(0) + 1);
    const mine = await claim(db, {
      kinds: ["observe", "finalize"],
      owner: OBS[0]?.toBase58() ?? null,
      leaseSeconds: 60,
      limit: 50,
      now: t,
    });
    expect(mine.map((j) => j.kind)).toEqual(["observe"]);
    const shared = await claim(db, {
      kinds: ["observe", "finalize"],
      owner: null,
      leaseSeconds: 60,
      limit: 50,
      now: t,
    });
    expect(shared.map((j) => j.kind)).toEqual(["finalize"]);
  });
});

// ---- finalize handler, against a fake chain ----------------------------------------------------------

function attestation(
  observer: PublicKey,
  over: Partial<EpochAttestationAccount["metrics"]> = {},
  payload = 0xaa,
): EpochAttestationAccount {
  return {
    mandate: MANDATE,
    epochIndex: 0,
    observer,
    observedSlot: 500n,
    observedUnixTs: BigInt(endOf(0) - 5),
    algorithmVersion: 1,
    positionSet: k(61),
    payloadHash: new Uint8Array(32).fill(payload),
    evidenceHash: new Uint8Array(32).fill(0xbb),
    metrics: {
      effectiveSpreadBps: 251,
      poolBuyDepthQuoteRaw: 1n,
      poolSellDepthQuoteRaw: 1n,
      providerQuoteInBandRaw: 1n,
      providerBaseQuoteEqInBandRaw: 1n,
      ...over,
    },
    createdAt: 1n,
  };
}

class FakeChain implements FinalizePorts {
  clock = at(endOf(0) + 1);
  resultExists = false;
  mandateStatus: MandateAccount["status"] = "Active";
  attestations = new Map<string, EpochAttestationAccount>();
  sent: TransactionInstruction[] = [];
  submitError: Error | null = null;
  finalizeOnSubmit = true;
  otherFinalizerWins = false;
  observers: readonly PublicKey[] = OBS;
  readonly payer = k(99);
  now(): Date {
    return this.clock;
  }
  loadMandate(): Promise<MandateAccount | null> {
    return Promise.resolve({
      startAt: BigInt(START),
      epochSeconds: BigInt(ES),
      unavailableRecoverySeconds: BigInt(RECOVERY),
      observerSet: k(60),
      status: this.mandateStatus,
    } as unknown as MandateAccount);
  }
  loadObserverSet(): Promise<{ observers: readonly PublicKey[]; threshold: number }> {
    return Promise.resolve({ observers: this.observers, threshold: 2 });
  }
  epochResultExists(): Promise<boolean> {
    return Promise.resolve(this.resultExists);
  }
  loadAttestations(): Promise<Map<string, EpochAttestationAccount>> {
    return Promise.resolve(this.attestations);
  }
  submit(ix: TransactionInstruction): Promise<string> {
    if (this.submitError) {
      if (this.otherFinalizerWins) this.resultExists = true; // someone else's transaction lands first
      return Promise.reject(this.submitError);
    }
    this.sent.push(ix);
    if (this.finalizeOnSubmit) this.resultExists = true;
    return Promise.resolve("sig");
  }
  attest(...obs: number[]): void {
    for (const i of obs) {
      const o = OBS[i];
      if (o) this.attestations.set(o.toBase58(), attestation(o));
    }
  }
}
const run = (c: FakeChain): Promise<Outcome> =>
  finalizeJob(c, { mandate: MANDATE, epoch: 0 }, { pollSeconds: 15 });

describe("finalize handler", () => {
  it("waits for the epoch to end, then for a quorum, without spending attempts", async () => {
    const c = new FakeChain();
    c.clock = at(endOf(0) - 10);
    expect(await run(c)).toEqual({ deferUntil: at(endOf(0)), reason: "epoch has not ended" });
    c.clock = at(endOf(0) + 5);
    c.attest(0);
    const o = await run(c);
    expect(o).toMatchObject({
      deferUntil: at(endOf(0) + 20),
      reason: "waiting for a quorum (1/2 attested)",
    });
    expect(c.sent).toEqual([]);
  });

  it("finalizes with exactly the matching attestations once, and is a no-op afterwards", async () => {
    const c = new FakeChain();
    c.attest(0, 1);
    c.attestations.set(
      OBS[2]?.toBase58() ?? "",
      attestation(OBS[2] ?? k(0), { effectiveSpreadBps: 9000 }),
    ); // dissenter
    expect(await run(c)).toBe("done");
    expect(c.sent).toHaveLength(1);
    const ix = c.sent[0];
    expect(ix?.keys.slice(-2).map((a) => a.pubkey.toBase58()).length).toBe(2);
    expect(ix?.keys.length).toBe(6 + 2); // fixed accounts plus only the two agreeing attestations
    expect(await run(c)).toBe("done");
    expect(c.sent).toHaveLength(1); // a retry sends nothing
  });

  it("treats a failed send as success when another finalizer won the race, and rethrows otherwise", async () => {
    const c = new FakeChain();
    c.attest(0, 1);
    c.submitError = new Error("custom program error: already in use");
    c.finalizeOnSubmit = false;
    await expect(run(c)).rejects.toThrow(/already in use/); // a genuine failure surfaces for retry
    c.otherFinalizerWins = true; // now the send fails because the epoch was finalized in between
    expect(await run(c)).toBe("done");
  });

  it("uses the unavailable path only at the recovery deadline", async () => {
    const c = new FakeChain();
    c.clock = at(endOf(0) + RECOVERY - 1);
    expect(await run(c)).toMatchObject({
      reason: expect.stringContaining("waiting for a quorum") as string,
    });
    expect(c.sent).toEqual([]);
    c.clock = at(endOf(0) + RECOVERY);
    expect(await run(c)).toBe("done");
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]?.keys.length).toBe(4); // payer, mandate, epoch_result, system program
  });

  it("dead-letters two conflicting quorums instead of choosing one", async () => {
    const c = new FakeChain();
    const four = [k(31), k(32), k(33), k(34)];
    c.observers = four;
    for (const [i, o] of four.entries())
      c.attestations.set(o.toBase58(), attestation(o, {}, i < 2 ? 0xaa : 0xcc));
    expect(await run(c)).toMatchObject({
      fatal: expect.stringContaining("conflicting quorums") as string,
    });
    expect(c.sent).toEqual([]);
  });

  it("lets one dissenting observer be outvoted", async () => {
    const c = new FakeChain();
    c.attest(0, 1);
    c.attestations.set(OBS[2]?.toBase58() ?? "", attestation(OBS[2] ?? k(0), {}, 0xcc));
    expect(await run(c)).toBe("done");
    expect(c.sent).toHaveLength(1);
  });

  it("does nothing for a mandate that is not active", async () => {
    const c = new FakeChain();
    c.mandateStatus = "Cancelled";
    expect(await run(c)).toBe("done");
    expect(c.sent).toEqual([]);
  });
});
