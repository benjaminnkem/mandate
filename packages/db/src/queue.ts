import type { Queryable } from "./db.ts";

export type JobState = "queued" | "running" | "succeeded" | "dead";

export interface Job {
  readonly key: string;
  readonly kind: string;
  /** The identity that must run this job (an observer's public key), or `null` for shared work. */
  readonly owner: string | null;
  readonly payload: unknown;
  readonly state: JobState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runAt: Date;
  readonly leaseUntil: Date | null;
  readonly lastError: string | null;
}

interface JobRow {
  key: string;
  kind: string;
  owner: string | null;
  payload: unknown;
  state: JobState;
  attempts: number;
  max_attempts: number;
  run_at: Date | string;
  lease_until: Date | string | null;
  last_error: string | null;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const toJob = (r: JobRow): Job => ({
  key: r.key,
  kind: r.kind,
  owner: r.owner,
  payload: r.payload,
  state: r.state,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  runAt: toDate(r.run_at),
  leaseUntil: r.lease_until === null ? null : toDate(r.lease_until),
  lastError: r.last_error,
});

export interface Backoff {
  readonly baseSeconds: number;
  readonly capSeconds: number;
}
export const DEFAULT_BACKOFF: Backoff = { baseSeconds: 5, capSeconds: 900 };

/** Delay before retry number `attempt` (1-based): base * 2^(attempt-1), capped. Pure and exact. */
export function backoffSeconds(attempt: number, backoff: Backoff = DEFAULT_BACKOFF): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  return Math.min(backoff.baseSeconds * 2 ** exponent, backoff.capSeconds);
}

/** Canonical job keys (docs/TECHNICAL_SPEC.md section 14). The key IS the idempotency key. */
export const jobKeys = {
  observe: (mandate: string, epoch: number, observer: string): string =>
    `observe:${mandate}:${epoch}:${observer}`,
  finalize: (mandate: string, epoch: number): string => `finalize:${mandate}:${epoch}`,
  backfill: (mandate: string, epoch: number): string => `backfill:${mandate}:${epoch}`,
  reconcile: (mandate: string): string => `reconcile:${mandate}`,
};

async function audit(
  q: Queryable,
  key: string,
  at: Date,
  event: string,
  attempt: number,
  detail?: string,
): Promise<void> {
  await q.query(
    "INSERT INTO jobs_audit (key, at, event, attempt, detail) VALUES ($1,$2,$3,$4,$5)",
    [key, at, event, attempt, detail ?? null],
  );
}

export interface EnqueueInput {
  readonly key: string;
  readonly kind: string;
  readonly owner?: string | null;
  readonly payload?: unknown;
  readonly runAt: Date;
  readonly maxAttempts?: number;
  readonly now: Date;
}

/**
 * Enqueue a job. Returns `true` if it was created and `false` if a job with that key already exists in ANY
 * state, including `succeeded`: a completed economic job is never re-created by a later planner pass.
 */
export async function enqueue(q: Queryable, job: EnqueueInput): Promise<boolean> {
  const result = await q.query(
    `INSERT INTO jobs (key, kind, owner, payload, state, attempts, max_attempts, run_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'queued',0,$5,$6,$7,$7) ON CONFLICT (key) DO NOTHING`,
    [
      job.key,
      job.kind,
      job.owner ?? null,
      JSON.stringify(job.payload ?? {}),
      job.maxAttempts ?? 6,
      job.runAt,
      job.now,
    ],
  );
  const created = result.rowCount === 1;
  if (created) await audit(q, job.key, job.now, "enqueued", 0);
  return created;
}

/**
 * Enqueue many jobs in one statement. Same semantics as `enqueue` (existing keys are left alone); returns how many
 * were created. Used by the planner, where per-job round trips dominate at thousands of mandates.
 */
export async function enqueueMany(q: Queryable, jobs: readonly EnqueueInput[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const rows = jobs.map((j) => ({
    key: j.key,
    kind: j.kind,
    owner: j.owner ?? null,
    payload: j.payload ?? {},
    max_attempts: j.maxAttempts ?? 6,
    run_at: j.runAt.toISOString(),
    now: j.now.toISOString(),
  }));
  const { rows: created } = await q.query<{ key: string; created_at: Date | string }>(
    `INSERT INTO jobs (key, kind, owner, payload, state, attempts, max_attempts, run_at, created_at, updated_at)
     SELECT r.key, r.kind, r.owner, r.payload, 'queued', 0, r.max_attempts, r.run_at::timestamptz, r.now::timestamptz, r.now::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS r(key text, kind text, owner text, payload jsonb, max_attempts int, run_at text, now text)
     ON CONFLICT (key) DO NOTHING RETURNING key, created_at`,
    [JSON.stringify(rows)],
  );
  if (created.length > 0)
    await q.query(
      `INSERT INTO jobs_audit (key, at, event, attempt) SELECT k, $2::timestamptz, 'enqueued', 0 FROM unnest($1::text[]) AS k`,
      [created.map((c) => c.key), jobs[0]?.now.toISOString()],
    );
  return created.length;
}

export interface ClaimInput {
  readonly kinds: readonly string[];
  /** Only jobs owned by this identity (or, when `null`, only unowned jobs). Observer jobs never cross identities. */
  readonly owner: string | null;
  readonly leaseSeconds: number;
  readonly limit: number;
  readonly now: Date;
}

/**
 * Lease due jobs to one worker. `FOR UPDATE SKIP LOCKED` means concurrent workers never receive the same job.
 * A `running` job whose lease expired is claimable again (its worker died), and counts that as another attempt.
 */
export async function claim(q: Queryable, input: ClaimInput): Promise<Job[]> {
  const leaseUntil = new Date(input.now.getTime() + input.leaseSeconds * 1000);
  const { rows } = await q.query<JobRow>(
    `UPDATE jobs SET state='running', attempts = attempts + 1, lease_until = $1, updated_at = $2
     WHERE key IN (
       SELECT key FROM jobs
       WHERE kind = ANY($3::text[])
         AND owner IS NOT DISTINCT FROM $4
         AND ((state = 'queued' AND run_at <= $2) OR (state = 'running' AND lease_until < $2))
         AND attempts < max_attempts
       ORDER BY run_at, key
       LIMIT $5
       FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [leaseUntil, input.now, [...input.kinds], input.owner, input.limit],
  );
  for (const r of rows) await audit(q, r.key, input.now, "claimed", r.attempts);
  return rows
    .map(toJob)
    .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.key.localeCompare(b.key));
}

export async function complete(q: Queryable, key: string, now: Date): Promise<void> {
  const { rows } = await q.query<{ attempts: number }>(
    `UPDATE jobs SET state='succeeded', lease_until=NULL, completed_at=$2, updated_at=$2, last_error=NULL
     WHERE key=$1 AND state='running' RETURNING attempts`,
    [key, now],
  );
  if (rows[0]) await audit(q, key, now, "succeeded", rows[0].attempts);
}

/**
 * Record a failed attempt. Below `max_attempts` the job is re-queued with exponential backoff; at the limit it
 * becomes `dead`, which stays visible (metrics, API, audit) until an operator deals with it. It is never dropped.
 */
export async function fail(
  q: Queryable,
  key: string,
  error: string,
  now: Date,
  backoff: Backoff = DEFAULT_BACKOFF,
): Promise<"queued" | "dead"> {
  const { rows } = await q.query<{ attempts: number; max_attempts: number }>(
    "SELECT attempts, max_attempts FROM jobs WHERE key=$1 AND state='running'",
    [key],
  );
  const row = rows[0];
  if (!row) return "dead";
  if (row.attempts >= row.max_attempts) {
    await q.query(
      "UPDATE jobs SET state='dead', lease_until=NULL, last_error=$2, updated_at=$3 WHERE key=$1",
      [key, error, now],
    );
    await audit(q, key, now, "dead", row.attempts, error);
    return "dead";
  }
  const runAt = new Date(now.getTime() + backoffSeconds(row.attempts, backoff) * 1000);
  await q.query(
    "UPDATE jobs SET state='queued', lease_until=NULL, run_at=$2, last_error=$3, updated_at=$4 WHERE key=$1",
    [key, runAt, error, now],
  );
  await audit(q, key, now, "retry", row.attempts, error);
  return "queued";
}

/**
 * Put a job back until `until` WITHOUT counting the attempt: used when the honest answer is "not yet" (an epoch that
 * has not ended, a quorum that has not formed). Waiting is normal operation, not failure, so it must not walk a job
 * toward the dead letter.
 */
export async function defer(
  q: Queryable,
  key: string,
  until: Date,
  now: Date,
  reason: string,
): Promise<void> {
  const { rows } = await q.query<{ attempts: number }>(
    `UPDATE jobs SET state='queued', attempts = GREATEST(attempts - 1, 0), lease_until=NULL, run_at=$2, updated_at=$3
     WHERE key=$1 AND state='running' RETURNING attempts`,
    [key, until, now],
  );
  if (rows[0]) await audit(q, key, now, "deferred", rows[0].attempts, reason);
}

/** Dead-letter a job immediately (a failure retrying cannot fix, such as a conflicting attestation). */
export async function kill(q: Queryable, key: string, error: string, now: Date): Promise<void> {
  const { rows } = await q.query<{ attempts: number }>(
    `UPDATE jobs SET state='dead', lease_until=NULL, last_error=$2, updated_at=$3
     WHERE key=$1 AND state='running' RETURNING attempts`,
    [key, error, now],
  );
  if (rows[0]) await audit(q, key, now, "dead", rows[0].attempts, error);
}

/** Jobs whose worker died and whose attempts are exhausted can never be claimed again: mark them dead. */
export async function reapExhausted(q: Queryable, now: Date): Promise<number> {
  const { rows } = await q.query<{ key: string; attempts: number }>(
    `UPDATE jobs SET state='dead', lease_until=NULL, updated_at=$1, last_error=COALESCE(last_error,'lease expired')
     WHERE state='running' AND lease_until < $1 AND attempts >= max_attempts RETURNING key, attempts`,
    [now],
  );
  for (const r of rows)
    await audit(q, r.key, now, "dead", r.attempts, "lease expired at max attempts");
  return rows.length;
}

export interface QueueStats {
  readonly queued: number;
  readonly running: number;
  readonly succeeded: number;
  readonly dead: number;
  readonly byKind: Record<string, Record<JobState, number>>;
}

export async function queueStats(q: Queryable): Promise<QueueStats> {
  const { rows } = await q.query<{ kind: string; state: JobState; n: string }>(
    "SELECT kind, state, count(*)::text AS n FROM jobs GROUP BY kind, state",
  );
  const totals = { queued: 0, running: 0, succeeded: 0, dead: 0 };
  const byKind: Record<string, Record<JobState, number>> = {};
  for (const r of rows) {
    const n = Number(r.n);
    totals[r.state] += n;
    const kind = byKind[r.kind] ?? { queued: 0, running: 0, succeeded: 0, dead: 0 };
    kind[r.state] = n;
    byKind[r.kind] = kind;
  }
  return { ...totals, byKind };
}

export async function deadJobs(q: Queryable, limit = 100): Promise<Job[]> {
  const { rows } = await q.query<JobRow>(
    "SELECT * FROM jobs WHERE state='dead' ORDER BY updated_at DESC, key LIMIT $1",
    [limit],
  );
  return rows.map(toJob);
}
