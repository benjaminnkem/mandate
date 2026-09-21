/**
 * Leader rotation for one epoch.
 *
 * Why a leader at all: independent observers reading a live chain see slightly different states, so they would
 * produce different payload hashes and never reach an exact quorum. Instead ONE observer measures the live pool
 * and publishes the exact snapshot; the others replay that snapshot and sign only if their own computation
 * reproduces the leader's hash exactly (docs/adr/0015). Agreement is therefore a strict equality check.
 *
 * Every observer must compute the same order from the same inputs, or two of them would both act as leader.
 */

/** Observers in leader order for an epoch: the observer-set order rotated by `epoch mod count`. */
export function leaderOrder(epochIndex: number, observers: readonly string[]): readonly string[] {
  if (observers.length === 0) throw new RangeError("an observer set cannot be empty");
  const offset = epochIndex % observers.length;
  return [...observers.slice(offset), ...observers.slice(0, offset)];
}

/** Zero-based rank of `me` for this epoch (0 is the primary leader). */
export function leaderRank(epochIndex: number, observers: readonly string[], me: string): number {
  const rank = leaderOrder(epochIndex, observers).indexOf(me);
  if (rank < 0) throw new RangeError("this observer is not in the observer set");
  return rank;
}

export interface LeaderTiming {
  /** Seconds before the epoch's end at which the primary leader observes. */
  readonly observeLeadSeconds: number;
  /** Seconds each further rank waits before stepping in as leader. */
  readonly leaderTimeoutSeconds: number;
}

/** The earliest instant rank `rank` may act as leader. Rank 0 acts at `epochEnd - lead`. */
export function leaderActsAt(epochEnd: number, rank: number, timing: LeaderTiming): number {
  return epochEnd - timing.observeLeadSeconds + rank * timing.leaderTimeoutSeconds;
}

/**
 * A timing configuration is usable only if the last rank still acts strictly before the epoch ends, otherwise a
 * late leader's observation would fall outside the epoch and be rejected by the program.
 */
export function timingFits(observerCount: number, timing: LeaderTiming): boolean {
  const lastRank = observerCount - 1;
  return (
    timing.observeLeadSeconds > 0 &&
    timing.leaderTimeoutSeconds > 0 &&
    lastRank * timing.leaderTimeoutSeconds < timing.observeLeadSeconds
  );
}
