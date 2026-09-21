import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backoffSeconds,
  claim,
  complete,
  deadJobs,
  enqueue,
  fail,
  jobKeys,
  migrate,
  queueStats,
  reapExhausted,
  runWorkerOnce,
  type Db,
  type Job,
  type Outcome,
} from "../src/index.ts";
import { createTestDb } from "../src/testing.ts";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

const T0 = new Date("2026-09-22T12:00:00Z");
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
const base = { kind: "finalize", runAt: T0, now: T0 };

describe("queue", () => {
  it("makes enqueue idempotent in every state, including after success", async () => {
    const key = jobKeys.finalize("M", 3);
    expect(await enqueue(db, { ...base, key })).toBe(true);
    expect(await enqueue(db, { ...base, key })).toBe(false);
    const [job] = await claim(db, {
      kinds: ["finalize"],
      owner: null,
      leaseSeconds: 60,
      limit: 5,
      now: T0,
    });
    await complete(db, job?.key ?? "", T0);
    expect(await enqueue(db, { ...base, key })).toBe(false);
    expect((await queueStats(db)).succeeded).toBe(1);
  });

  it("never hands one job to two workers, and respects run_at", async () => {
    for (let i = 0; i < 10; i++) await enqueue(db, { ...base, key: `finalize:M:${i}` });
    await enqueue(db, { ...base, key: "finalize:M:late", runAt: at(100) });
    const claims = { kinds: ["finalize"], owner: null, leaseSeconds: 60, now: T0 };
    const [a, b] = await Promise.all([
      claim(db, { ...claims, limit: 6 }),
      claim(db, { ...claims, limit: 6 }),
    ]);
    const keys = [...a, ...b].map((j) => j.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(10);
    expect(keys).not.toContain("finalize:M:late");
  });

  it("separates jobs by owner identity", async () => {
    await enqueue(db, {
      ...base,
      kind: "observe",
      key: jobKeys.observe("M", 0, "obsA"),
      owner: "obsA",
    });
    await enqueue(db, {
      ...base,
      kind: "observe",
      key: jobKeys.observe("M", 0, "obsB"),
      owner: "obsB",
    });
    await enqueue(db, { ...base, key: "finalize:M:0" });
    const mine = await claim(db, {
      kinds: ["observe", "finalize"],
      owner: "obsA",
      leaseSeconds: 60,
      limit: 10,
      now: T0,
    });
    expect(mine.map((j) => j.key)).toEqual(["observe:M:0:obsA"]);
    const shared = await claim(db, {
      kinds: ["observe", "finalize"],
      owner: null,
      leaseSeconds: 60,
      limit: 10,
      now: T0,
    });
    expect(shared.map((j) => j.key)).toEqual(["finalize:M:0"]);
  });

  it("retries with exponential backoff and then dead-letters visibly", async () => {
    expect([1, 2, 3, 4, 10].map((n) => backoffSeconds(n))).toEqual([5, 10, 20, 40, 900]);
    await enqueue(db, { ...base, key: "finalize:M:1", maxAttempts: 3 });
    let now = T0;
    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [job] = await claim(db, {
        kinds: ["finalize"],
        owner: null,
        leaseSeconds: 60,
        limit: 1,
        now,
      });
      expect(job?.attempts).toBe(attempt);
      outcomes.push(await fail(db, "finalize:M:1", "rpc timeout", now));
      now = at(now.getTime() / 1000 - T0.getTime() / 1000 + backoffSeconds(attempt) + 1);
    }
    expect(outcomes).toEqual(["queued", "queued", "dead"]);
    expect(
      await claim(db, {
        kinds: ["finalize"],
        owner: null,
        leaseSeconds: 60,
        limit: 1,
        now: at(99_999),
      }),
    ).toEqual([]);
    const dead = await deadJobs(db);
    expect(dead.map((j) => [j.key, j.lastError])).toEqual([["finalize:M:1", "rpc timeout"]]);
    const events = await db.query<{ event: string }>(
      "SELECT event FROM jobs_audit WHERE key='finalize:M:1' ORDER BY id",
    );
    expect(events.rows.map((r) => r.event)).toEqual([
      "enqueued",
      "claimed",
      "retry",
      "claimed",
      "retry",
      "claimed",
      "dead",
    ]);
  });

  it("waits out the backoff before a retry becomes claimable", async () => {
    await enqueue(db, { ...base, key: "finalize:M:2" });
    await claim(db, { kinds: ["finalize"], owner: null, leaseSeconds: 60, limit: 1, now: T0 });
    await fail(db, "finalize:M:2", "boom", T0);
    const c = { kinds: ["finalize"], owner: null, leaseSeconds: 60, limit: 1 };
    expect(await claim(db, { ...c, now: at(4) })).toEqual([]);
    expect(await claim(db, { ...c, now: at(5) })).toHaveLength(1);
  });

  it("re-leases a job whose worker died, and dead-letters it once attempts are exhausted", async () => {
    await enqueue(db, { ...base, key: "finalize:M:3", maxAttempts: 2 });
    const c = { kinds: ["finalize"], owner: null, leaseSeconds: 30, limit: 1 };
    expect(await claim(db, { ...c, now: T0 })).toHaveLength(1);
    expect(await claim(db, { ...c, now: at(10) })).toEqual([]); // still leased
    expect(await claim(db, { ...c, now: at(31) })).toHaveLength(1); // worker died: attempt 2
    expect(await claim(db, { ...c, now: at(100) })).toEqual([]); // exhausted
    expect(await reapExhausted(db, at(100))).toBe(1);
    expect((await queueStats(db)).dead).toBe(1);
  });
});

describe("worker", () => {
  const opts = (handlers: Record<string, (j: Job) => Promise<Outcome>>, now: Date) => ({
    kinds: Object.keys(handlers),
    owner: null,
    handlers,
    leaseSeconds: 60,
    limit: 10,
    now: () => now,
  });

  it("completes, defers without spending attempts, dead-letters fatals, and retries throws", async () => {
    for (const k of ["a", "b", "c", "d"])
      await enqueue(db, { ...base, kind: k, key: `${k}:1`, maxAttempts: 2 });
    const later = new Date(T0.getTime() + 600_000);
    const run = (now: Date) =>
      runWorkerOnce(
        db,
        opts(
          {
            a: () => Promise.resolve("done"),
            b: () => Promise.resolve({ deferUntil: later, reason: "quorum not yet reached" }),
            c: () => Promise.resolve({ fatal: "conflicting attestation" }),
            d: () => Promise.reject(new Error("rpc down")),
          },
          now,
        ),
      );
    expect(await run(T0)).toEqual({ done: 1, deferred: 1, retried: 1, dead: 1 });
    const stats = await queueStats(db);
    expect([stats.succeeded, stats.queued, stats.dead]).toEqual([1, 2, 1]);
    // b was deferred repeatedly: attempts never accumulate, so waiting can never dead-letter it.
    for (let i = 0; i < 5; i++) await run(new Date(later.getTime() + i * 1000));
    const b = await db.query<{ attempts: number; state: string }>(
      "SELECT attempts, state FROM jobs WHERE key='b:1'",
    );
    expect(b.rows[0]).toMatchObject({ state: "queued" });
    expect(b.rows[0]?.attempts).toBeLessThanOrEqual(1);
  });

  it("only runs the jobs owned by its identity", async () => {
    await enqueue(db, { ...base, kind: "observe", key: "observe:M:0:A", owner: "A" });
    await enqueue(db, { ...base, kind: "observe", key: "observe:M:0:B", owner: "B" });
    const seen: string[] = [];
    const handlers = {
      observe: (j: Job) => {
        seen.push(j.key);
        return Promise.resolve("done" as const);
      },
    };
    await runWorkerOnce(db, { ...opts(handlers, T0), owner: "A" });
    expect(seen).toEqual(["observe:M:0:A"]);
  });
});
