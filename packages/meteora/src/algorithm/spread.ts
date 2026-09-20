import { BPS } from "./constants.ts";
import { MeasurementError } from "./types.ts";

/**
 * Effective two-sided (probe round-trip) spread in integer basis points:
 *
 *     spread_bps = ceil(2 * |Q0 - S0| * 10_000 / (Q0 + S0))
 *
 * `Q0` is the quote spent to buy `B0` base; `S0` is the quote received selling the same `B0`. Base
 * decimals cancel, so no price or decimals are needed. Widened (arbitrary precision) arithmetic.
 * The result is at most 20_000 for positive inputs, so it always fits u32.
 */
export function effectiveSpreadBps(q0: bigint, s0: bigint): bigint {
  if (q0 <= 0n || s0 <= 0n)
    throw new MeasurementError("InvalidProbe", "probe amounts must be positive");
  const diff = q0 > s0 ? q0 - s0 : s0 - q0;
  const numerator = 2n * diff * BPS;
  const denominator = q0 + s0;
  return (numerator + denominator - 1n) / denominator;
}
