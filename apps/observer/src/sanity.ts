import type { PoolObservation } from "@mandate/meteora";

export interface SanityTolerance {
  /** Largest allowed difference in the active bin id between the replayed snapshot and the live pool. */
  readonly maxActiveBinDrift: number;
  /** Largest allowed difference in the effective spread, in bps. */
  readonly maxSpreadDriftBps: number;
}

export const DEFAULT_TOLERANCE: SanityTolerance = { maxActiveBinDrift: 50, maxSpreadDriftBps: 150 };

/**
 * A follower replays the leader's snapshot and must reproduce its hash exactly. That proves the arithmetic, not
 * that the snapshot is real chain state: a hostile leader could invent accounts. So before signing, the follower
 * compares the snapshot with the live chain it can see for itself:
 *
 *  - things that cannot legitimately change between the snapshot and now must be identical (pool, program, mints,
 *    orientation, token-2022 state, and every registered position's owner, pool and range);
 *  - things that move with trading must be within a bound (active bin, spread).
 *
 * This is a plausibility gate, not proof: a forgery close to the live state would pass. The stronger guarantee is
 * the quorum itself and independent observer infrastructure (docs/adr/0015).
 * Returns the reasons the snapshot is implausible; empty means plausible.
 */
export function checkSnapshotPlausibility(
  replayed: PoolObservation,
  live: PoolObservation,
  tolerance: SanityTolerance = DEFAULT_TOLERANCE,
): string[] {
  const problems: string[] = [];
  const same = (name: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      problems.push(`${name} differs from live chain state`);
  };

  same(
    "pool identity",
    pick(replayed.pool, ["address", "programId", "baseMint", "quoteMint", "baseIsX", "binStep"]),
    pick(live.pool, ["address", "programId", "baseMint", "quoteMint", "baseIsX", "binStep"]),
  );
  same(
    "base mint state",
    { ...replayed.baseMintState, observationEpoch: "", effectiveTransferFeeBps: 0 },
    { ...live.baseMintState, observationEpoch: "", effectiveTransferFeeBps: 0 },
  );
  same(
    "registered position ownership and ranges",
    replayed.measurement.provider.perPosition.map((p) => [
      p.address,
      p.verdict,
      p.owner,
      p.lowerBinId,
      p.upperBinId,
    ]),
    live.measurement.provider.perPosition.map((p) => [
      p.address,
      p.verdict,
      p.owner,
      p.lowerBinId,
      p.upperBinId,
    ]),
  );

  const drift = Math.abs(replayed.pool.activeId - live.pool.activeId);
  if (drift > tolerance.maxActiveBinDrift) {
    problems.push(
      `active bin moved ${String(drift)} bins since the snapshot (allowed ${String(tolerance.maxActiveBinDrift)})`,
    );
  }
  const spreadDrift = Math.abs(
    replayed.measurement.metrics.effectiveSpreadBps - live.measurement.metrics.effectiveSpreadBps,
  );
  if (spreadDrift > tolerance.maxSpreadDriftBps) {
    problems.push(
      `effective spread differs by ${String(spreadDrift)} bps from live (allowed ${String(tolerance.maxSpreadDriftBps)})`,
    );
  }
  return problems;
}

function pick<T extends object>(value: T, keys: readonly (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.map((k) => [k, value[k]])) as Partial<T>;
}
