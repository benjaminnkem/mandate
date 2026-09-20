/**
 * Run a synchronous function with `Date.now()` pinned to an exact instant.
 *
 * Why this exists: the official SDK's `swapQuote` reads `Date.now()` to decide how much of the
 * volatility accumulator has decayed, which changes the dynamic fee. Two quotes on the same
 * account state a few seconds apart can therefore differ. Measurement must be a pure function of
 * the snapshot, so every quote runs with the clock pinned to the snapshot's own on-chain Clock
 * timestamp. (Verified against `@meteora-ag/dlmm` 1.9.14: `swapQuote` -> `DLMM.updateReference`.)
 *
 * Only synchronous callbacks are allowed: an async callback could interleave with other work while
 * the global is overridden.
 */
export function withPinnedClock<T>(unixSeconds: bigint, fn: () => T): T {
  const original = Date.now;
  const pinned = Number(unixSeconds) * 1000;
  Date.now = () => pinned;
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new TypeError("withPinnedClock accepts only synchronous callbacks");
    }
    return result;
  } finally {
    Date.now = original;
  }
}
