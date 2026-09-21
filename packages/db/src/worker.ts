import type { Db } from "./db.ts";
import {
  claim,
  complete,
  defer,
  fail,
  kill,
  reapExhausted,
  type Backoff,
  type Job,
} from "./queue.ts";

/** What a handler says happened. Throwing means "failed, retry with backoff". */
export type Outcome =
  | "done"
  /** Not yet: try again at this time without counting an attempt. */
  | { readonly deferUntil: Date; readonly reason: string }
  /** Unrecoverable: dead-letter now and make it visible. */
  | { readonly fatal: string };

export type Handler = (job: Job) => Promise<Outcome>;

export interface WorkerOptions {
  readonly kinds: readonly string[];
  /** The identity this worker runs as; it only ever receives jobs owned by it (or, for `null`, unowned jobs). */
  readonly owner: string | null;
  readonly handlers: Readonly<Record<string, Handler>>;
  readonly leaseSeconds: number;
  readonly limit: number;
  readonly now: () => Date;
  readonly backoff?: Backoff;
  readonly onResult?: (job: Job, result: "done" | "deferred" | "retry" | "dead") => void;
}

export interface WorkerReport {
  readonly done: number;
  readonly deferred: number;
  readonly retried: number;
  readonly dead: number;
}

/** Claim a batch of due jobs and run them, recording each outcome. Safe to call from many processes at once. */
export async function runWorkerOnce(db: Db, o: WorkerOptions): Promise<WorkerReport> {
  const report = { done: 0, deferred: 0, retried: 0, dead: 0 };
  await reapExhausted(db, o.now());
  const jobs = await claim(db, {
    kinds: o.kinds,
    owner: o.owner,
    leaseSeconds: o.leaseSeconds,
    limit: o.limit,
    now: o.now(),
  });
  for (const job of jobs) {
    const handler = o.handlers[job.kind];
    try {
      if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
      const outcome = await handler(job);
      if (outcome === "done") {
        await complete(db, job.key, o.now());
        report.done += 1;
        o.onResult?.(job, "done");
      } else if ("deferUntil" in outcome) {
        await defer(db, job.key, outcome.deferUntil, o.now(), outcome.reason);
        report.deferred += 1;
        o.onResult?.(job, "deferred");
      } else {
        await kill(db, job.key, outcome.fatal, o.now());
        report.dead += 1;
        o.onResult?.(job, "dead");
      }
    } catch (error) {
      const state = await fail(
        db,
        job.key,
        error instanceof Error ? error.message : String(error),
        o.now(),
        o.backoff,
      );
      if (state === "dead") report.dead += 1;
      else report.retried += 1;
      o.onResult?.(job, state === "dead" ? "dead" : "retry");
    }
  }
  return report;
}
