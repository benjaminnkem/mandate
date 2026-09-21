import type { Handler, Outcome } from "@mandate/db";

import { AttestationConflictError, EvidenceConflictError } from "./errors.ts";
import type { JobResult } from "./job.ts";

/** How one epoch job's result maps onto the queue: finished, not yet, or a failure to retry or escalate. */
export function toOutcome(result: JobResult): Outcome {
  switch (result.status) {
    // Nothing left for this observer to do: it attested, or the mandate stopped, the epoch is not in the schedule,
    // or the attestation window closed. The chain records why; the queue job is finished.
    case "attested":
    case "already-attested":
    case "mandate-not-active":
    case "epoch-out-of-range":
    case "window-closed":
      return "done";
    case "too-early":
    case "waiting-for-leader":
      return { deferUntil: new Date(result.actsAt * 1000), reason: result.status };
    case "cannot-verify":
      throw new Error(`cannot verify: ${result.reasons.join("; ")}`);
    case "observation-outside-epoch":
      throw new Error(`observation at ${result.observedUnixTs.toString()} is outside the epoch`);
  }
}

/**
 * Queue handler for `observe` jobs, run by ONE observer process for ONE identity. A conflict between chain and
 * this observer's own evidence is never retried: it is dead-lettered immediately so a human looks at it.
 */
export function observeHandler(
  run: (input: { mandate: string; epochIndex: number }) => Promise<JobResult>,
): Handler {
  return async (job) => {
    const payload = job.payload as { mandate: string; epoch: number };
    try {
      return toOutcome(await run({ mandate: payload.mandate, epochIndex: payload.epoch }));
    } catch (error) {
      if (error instanceof AttestationConflictError || error instanceof EvidenceConflictError)
        return { fatal: error.message };
      throw error;
    }
  };
}
