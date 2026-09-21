import { enqueueMany, jobKeys, type Db, type EnqueueInput } from "@mandate/db";

export interface PlannerConfig {
  /** Plan an epoch's jobs this long before it ends (must cover the observers' lead time). */
  readonly lookaheadSeconds: number;
  /** How early before epoch end observe jobs become due. */
  readonly observeLeadSeconds: number;
  readonly maxAttempts?: number;
}

interface Due {
  address: string;
  epoch: number;
  epoch_end: string;
  observer_set: string;
}

export interface PlanReport {
  readonly epochsPlanned: number;
  readonly jobsCreated: number;
}

/**
 * Turn the read model into jobs. For every active mandate epoch that ends within the lookahead, has no on-chain
 * result and has not been planned before, create in ONE transaction: a `finalize` job (shared, due at epoch end) and
 * one `observe` job per observer in the mandate's set, each owned by that observer's key. Because job keys are the
 * idempotency keys, running the planner any number of times, concurrently, plans each epoch exactly once.
 *
 * `reconcile` is owned by the indexer's periodic vault reconciliation, which overwrites a row and so needs no queue.
 */
export async function planJobs(db: Db, now: Date, config: PlannerConfig): Promise<PlanReport> {
  const horizon = Math.floor(now.getTime() / 1000) + config.lookaheadSeconds;
  const { rows } = await db.query<Due>(
    `SELECT m.address, g.e AS epoch,
            (m.start_at + (g.e + 1) * (m.data->>'epochSeconds')::bigint)::text AS epoch_end,
            m.data->>'observerSet' AS observer_set
     FROM mandates m
     CROSS JOIN LATERAL generate_series(
        0, LEAST(m.total_epochs - 1, (($1::bigint - m.start_at) / (m.data->>'epochSeconds')::bigint)::int - 1)) AS g(e)
     WHERE m.status = 'Active'
       AND NOT EXISTS (SELECT 1 FROM epoch_results r WHERE r.mandate = m.address AND r.epoch_index = g.e)
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.key = 'finalize:' || m.address || ':' || g.e::text)
     ORDER BY epoch_end, m.address`,
    [horizon],
  );
  if (rows.length === 0) return { epochsPlanned: 0, jobsCreated: 0 };

  const sets = new Map<string, string[]>();
  const observersOf = async (address: string): Promise<string[]> => {
    const cached = sets.get(address);
    if (cached) return cached;
    const r = await db.query<{ data: { observers: string[]; observerCount: number } }>(
      "SELECT data FROM observer_sets WHERE address = $1",
      [address],
    );
    const data = r.rows[0]?.data;
    const list = data ? data.observers.slice(0, data.observerCount) : [];
    sets.set(address, list);
    return list;
  };

  let jobsCreated = 0;
  // Batches keep round trips low at scale. Each batch is one transaction, so an epoch's finalize and observe jobs are
  // created together or not at all; a crash between batches just leaves the rest for the next pass.
  const BATCH = 250;
  for (let i = 0; i < rows.length; i += BATCH) {
    const jobs: EnqueueInput[] = [];
    for (const due of rows.slice(i, i + BATCH)) {
      const epochEnd = new Date(Number(due.epoch_end) * 1000);
      const base = {
        payload: { mandate: due.address, epoch: due.epoch },
        now,
        maxAttempts: config.maxAttempts ?? 6,
      };
      for (const observer of await observersOf(due.observer_set))
        jobs.push({
          ...base,
          key: jobKeys.observe(due.address, due.epoch, observer),
          kind: "observe",
          owner: observer,
          runAt: new Date(epochEnd.getTime() - config.observeLeadSeconds * 1000),
        });
      jobs.push({
        ...base,
        key: jobKeys.finalize(due.address, due.epoch),
        kind: "finalize",
        runAt: epochEnd,
      });
    }
    jobsCreated += await db.transaction((tx) => enqueueMany(tx, jobs));
  }
  return { epochsPlanned: rows.length, jobsCreated };
}
