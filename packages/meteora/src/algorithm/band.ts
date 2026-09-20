import { BPS, MAX_BAND_BINS } from "./constants.ts";
import { MeasurementError } from "./types.ts";

export interface BinBand {
  readonly lowerBinId: number;
  readonly upperBinId: number;
  /** Bins below the active bin included in the band. */
  readonly binsBelow: number;
  /** Bins above the active bin included in the band. */
  readonly binsAbove: number;
}

/**
 * Convert a price band of `bandBps` around the active bin into an inclusive range of bin ids, with
 * exact integer arithmetic (no floating point, no SDK decimals).
 *
 * DLMM bin `i` has price `(1 + binStep/10_000)^i`. With `r = (10_000 + binStep) / 10_000`:
 *   - `binsAbove` is the largest `k >= 0` with `r^k <= (10_000 + band) / 10_000`
 *   - `binsBelow` is the largest `k >= 0` with `r^-k >= (10_000 - band) / 10_000`
 * both evaluated by cross-multiplication, so a bin exactly on the boundary is inside the band.
 */
export function bandBinRange(activeId: number, binStep: number, bandBps: bigint): BinBand {
  if (!Number.isSafeInteger(activeId)) throw new MeasurementError("InvalidBand", "active bin id");
  if (!Number.isSafeInteger(binStep) || binStep < 1)
    throw new MeasurementError("InvalidBand", "bin step");
  if (bandBps < 1n || bandBps >= BPS)
    throw new MeasurementError("InvalidBand", "band must be in [1, 9999] bps");

  const step = BigInt(binStep);
  const up = BPS + step; // numerator of r
  const upLimit = BPS + bandBps;
  const downLimit = BPS - bandBps;

  let binsAbove = 0;
  let num = 1n; // up^k
  let den = 1n; // BPS^k
  for (;;) {
    const nextNum = num * up;
    const nextDen = den * BPS;
    // r^(k+1) <= upLimit / BPS  <=>  nextNum * BPS <= upLimit * nextDen
    if (nextNum * BPS > upLimit * nextDen) break;
    num = nextNum;
    den = nextDen;
    binsAbove += 1;
    if (binsAbove > MAX_BAND_BINS)
      throw new MeasurementError("InvalidBand", "band spans too many bins");
  }

  let binsBelow = 0;
  num = 1n;
  den = 1n;
  for (;;) {
    const nextNum = num * up;
    const nextDen = den * BPS;
    // r^-(k+1) >= downLimit / BPS  <=>  BPS^(k+1) * BPS >= downLimit * up^(k+1)
    if (nextDen * BPS < downLimit * nextNum) break;
    num = nextNum;
    den = nextDen;
    binsBelow += 1;
    if (binsBelow > MAX_BAND_BINS)
      throw new MeasurementError("InvalidBand", "band spans too many bins");
  }

  return {
    lowerBinId: activeId - binsBelow,
    upperBinId: activeId + binsAbove,
    binsBelow,
    binsAbove,
  };
}
