/**
 * Constants of measurement algorithm version 1. They are part of the algorithm, not of any
 * mandate: every observer must use identical values, and changing any of them requires a new
 * `ALGORITHM_VERSION` (docs/TECHNICAL_SPEC.md section 7.7).
 */
export const ALGORITHM_VERSION = 1;

/** Hard upper bound of any depth search, in quote (USDC) raw units. 10^14 raw = 100,000,000 USDC. */
export const SEARCH_CAP_QUOTE_RAW = 10n ** 14n;

/** Each exponential step multiplies the candidate by this factor. */
export const SEARCH_GROWTH_FACTOR = 2n;

/** Maximum exponential expansion steps before the cap is treated as reached. */
export const MAX_EXPANSION_STEPS = 48;

/** Binary search stops when the pass/fail bracket is this many raw units wide (1 = exact boundary). */
export const SEARCH_RESOLUTION_RAW = 1n;

/** Maximum binary search iterations. 64 halvings always exhaust a u64 bracket. */
export const MAX_BINARY_ITERATIONS = 64;

/** Guard for the band-to-bin conversion loops. Far above any protocol-permitted band. */
export const MAX_BAND_BINS = 20_000;

export const BPS = 10_000n;
