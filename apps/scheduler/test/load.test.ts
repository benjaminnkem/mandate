import { claim, migrate, queueStats, runWorkerOnce, type Db, type Handler } from "@mandate/db";
import { createTestDb } from "@mandate/db/testing";
import { seedSynthetic, type SyntheticWorld } from "@mandate/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planJobs } from "../src/planner.ts";

/**
 * SYNTHETIC LOAD TEST of worker scheduling. Fabricated data from @mandate/testkit; nothing here is chain state.
 * Size: LOAD_MANDATES (default 150; `pnpm test:load` uses thousands).
 */
const N = Number(process.env["LOAD_MANDATES"] ?? "150");
const EPOCHS = 72;
const NOW_UNIX = 2_000_000_000;
const now = new Date(NOW_UNIX * 1000);
const cfg = { lookaheadSeconds: 120, observeLeadSeconds: 60 };

let db: Db;
let world: SyntheticWorld;
beforeAll(async () => {
  db = await createTestDb();
  await migrate(db);
  world = await seedSynthetic(db, {
    mandates: N,
    epochsEach: EPOCHS,
    nowUnix: NOW_UNIX,
    startOffsetSeconds: 40 * 300,
    resolvedFraction: 0.5,
  });
}, 600_000);
afterAll(async () => {
  await db.close();
});

describe("scheduling under synthetic load", () => {
  it("plans every unresolved due epoch exactly once, however often and however concurrently it runs", async () => {
    const t = performance.now();
    const first = await planJobs(db, now, cfg);
    const planMs = performance.now() - t;
    const stats = await queueStats(db);
    const finalize = stats.byKind["finalize"]?.queued ?? 0;
    const observe = stats.byKind["observe"]?.queued ?? 0;
    console.log(
      `SYNTHETIC LOAD TEST planner: mandates=${N} epochsPlanned=${first.epochsPlanned} jobs=${first.jobsCreated} in ${planMs.toFixed(0)}ms`,
    );
    expect(finalize).toBe(first.epochsPlanned);
    expect(observe).toBe(first.epochsPlanned * world.observers.length);
    expect(first.jobsCreated).toBe(finalize + observe);
    // Independent count from the read model: active mandates x due epochs without a result.
    const expected = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM mandates m CROSS JOIN LATERAL generate_series(0, 40) g(e)
       WHERE m.status='Active' AND m.total_epochs > g.e AND m.start_at + (g.e+1)*300 <= $1
         AND NOT EXISTS (SELECT 1 FROM epoch_results r WHERE r.mandate=m.address AND r.epoch_index=g.e)`,
      [NOW_UNIX + cfg.lookaheadSeconds],
    );
    expect(first.epochsPlanned).toBe(Number(expected.rows[0]?.n));

    await Promise.all([planJobs(db, now, cfg), planJobs(db, now, cfg), planJobs(db, now, cfg)]);
    const after = await queueStats(db);
    expect([after.byKind["finalize"]?.queued, after.byKind["observe"]?.queued]).toEqual([
      finalize,
      observe,
    ]);
  }, 600_000);

  it("drains all jobs with parallel workers, running each exactly once and never crossing observer identities", async () => {
    const seen = new Map<string, number>();
    const wrongOwner: string[] = [];
    const mk = (owner: string | null): Record<string, Handler> => ({
      finalize: (job) => {
        seen.set(job.key, (seen.get(job.key) ?? 0) + 1);
        return Promise.resolve("done");
      },
      observe: (job) => {
        seen.set(job.key, (seen.get(job.key) ?? 0) + 1);
        if (job.owner !== owner) wrongOwner.push(job.key);
        return Promise.resolve("done");
      },
    });
    const total = (await queueStats(db)).queued;
    const later = new Date(now.getTime() + 3 * 3600 * 1000); // everything is due
    const workers = [null, ...world.observers];
    const t = performance.now();
    let guard = 0;
    while ((await queueStats(db)).queued > 0 && guard++ < 10_000) {
      await Promise.all(
        workers.map((owner) =>
          runWorkerOnce(db, {
            kinds: owner === null ? ["finalize"] : ["observe"],
            owner,
            handlers: mk(owner),
            leaseSeconds: 300,
            limit: 100,
            now: () => later,
          }),
        ),
      );
    }
    const ms = performance.now() - t;
    console.log(
      `SYNTHETIC LOAD TEST workers: drained ${total} jobs with ${workers.length} workers in ${ms.toFixed(0)}ms (${((total / ms) * 1000).toFixed(0)} jobs/s)`,
    );
    expect(seen.size).toBe(total);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(wrongOwner).toEqual([]);
    const stats = await queueStats(db);
    expect([stats.queued, stats.running, stats.dead, stats.succeeded]).toEqual([0, 0, 0, total]);
    // Nothing is claimable any more, and re-planning does not resurrect finished work.
    expect(
      await claim(db, {
        kinds: ["finalize", "observe"],
        owner: null,
        leaseSeconds: 1,
        limit: 10,
        now: later,
      }),
    ).toEqual([]);
    expect((await planJobs(db, now, cfg)).jobsCreated).toBe(0);
  }, 900_000);
});
