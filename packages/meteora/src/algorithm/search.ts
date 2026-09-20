import {
  BPS,
  MAX_BINARY_ITERATIONS,
  MAX_EXPANSION_STEPS,
  SEARCH_GROWTH_FACTOR,
  SEARCH_RESOLUTION_RAW,
} from "./constants.ts";
import type { QuoteEngine } from "./types.ts";

export type FailureReason = "NotFullyConsumed" | "NoOutput" | "ImpactExceeded" | "Unquotable";

export interface Evaluation {
  readonly pass: boolean;
  readonly reason?: FailureReason;
  /** Output of the quote when one was produced. */
  readonly out?: bigint;
}

/** Compact proof that a depth is the boundary: the largest passing input and the smallest failing one. */
export interface BoundaryProof {
  readonly passingInput: bigint;
  readonly passingOut: bigint;
  /** `null` only when the search cap was reached without ever failing. */
  readonly failingInput: bigint | null;
  readonly failingReason: FailureReason | null;
  readonly capReached: boolean;
  readonly quoteCalls: number;
}

/**
 * Baseline buy probe and one buy candidate. Passes iff the full input is consumed, some output is
 * produced, and the average price stays within `bandBps` of the baseline:
 *
 *     Q / B <= (Q0 / B0) * (10_000 + band) / 10_000
 *     <=>  Q * B0 * 10_000 <= Q0 * B * (10_000 + band)
 */
export function evaluateBuy(
  engine: QuoteEngine,
  q0: bigint,
  b0: bigint,
  bandBps: bigint,
  candidate: bigint,
): Evaluation {
  const quote = engine.buy(candidate);
  if (quote === null) return { pass: false, reason: "Unquotable" };
  if (quote.consumedIn !== candidate)
    return { pass: false, reason: "NotFullyConsumed", out: quote.out };
  if (quote.out <= 0n) return { pass: false, reason: "NoOutput", out: quote.out };
  const within = candidate * b0 * BPS <= q0 * quote.out * (BPS + bandBps);
  return within
    ? { pass: true, out: quote.out }
    : { pass: false, reason: "ImpactExceeded", out: quote.out };
}

/**
 * One sell candidate against the baseline sell price `S0 / B0`:
 *
 *     S / B >= (S0 / B0) * (10_000 - band) / 10_000
 *     <=>  S * B0 * 10_000 >= S0 * B * (10_000 - band)
 */
export function evaluateSell(
  engine: QuoteEngine,
  b0: bigint,
  s0: bigint,
  bandBps: bigint,
  candidate: bigint,
): Evaluation {
  const quote = engine.sell(candidate);
  if (quote === null) return { pass: false, reason: "Unquotable" };
  if (quote.consumedIn !== candidate)
    return { pass: false, reason: "NotFullyConsumed", out: quote.out };
  if (quote.out <= 0n) return { pass: false, reason: "NoOutput", out: quote.out };
  const within = quote.out * b0 * BPS >= s0 * candidate * (BPS - bandBps);
  return within
    ? { pass: true, out: quote.out }
    : { pass: false, reason: "ImpactExceeded", out: quote.out };
}

/**
 * Largest `x` in `[known, cap]` such that `evaluate(x)` passes, given that `known` passes.
 * Deterministic: exponential growth by a fixed factor to bracket the boundary, then integer
 * binary search to a fixed resolution. Assumes the predicate is monotone (pass then fail) as an
 * average-price impact band is; the result is by definition what this procedure returns.
 */
export function searchMaxPassing(
  known: bigint,
  cap: bigint,
  evaluate: (candidate: bigint) => Evaluation,
): BoundaryProof {
  let calls = 0;
  const run = (candidate: bigint): Evaluation => {
    calls += 1;
    return evaluate(candidate);
  };

  let low = known;
  let high: bigint | null = null;
  let highReason: FailureReason | null = null;
  let capReached = false;

  if (low >= cap) {
    capReached = true;
  } else {
    let steps = 0;
    for (;;) {
      if (steps >= MAX_EXPANSION_STEPS || low >= cap) {
        capReached = true;
        break;
      }
      const next = low * SEARCH_GROWTH_FACTOR > cap ? cap : low * SEARCH_GROWTH_FACTOR;
      const result = run(next);
      if (result.pass) {
        low = next;
        steps += 1;
      } else {
        high = next;
        highReason = result.reason ?? "Unquotable";
        break;
      }
    }
  }

  if (high !== null) {
    let failing: bigint = high;
    let iterations = 0;
    while (failing - low > SEARCH_RESOLUTION_RAW && iterations < MAX_BINARY_ITERATIONS) {
      const mid: bigint = low + (failing - low) / 2n;
      const result = run(mid);
      if (result.pass) {
        low = mid;
      } else {
        failing = mid;
        highReason = result.reason ?? "Unquotable";
      }
      iterations += 1;
    }
    high = failing;
  }

  // Re-evaluate the boundary to report its output. Deterministic, one extra call.
  const boundary = run(low);
  return {
    passingInput: low,
    passingOut: boundary.out ?? 0n,
    failingInput: high,
    failingReason: highReason,
    capReached,
    quoteCalls: calls,
  };
}
