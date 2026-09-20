/** A quote produced by a venue for an exact-input swap. All amounts are raw integers. */
export interface Quote {
  /** Input the venue actually consumed. Anything below the requested input is a partial fill. */
  readonly consumedIn: bigint;
  /** Output the trader actually receives (net of every fee, including token transfer fees). */
  readonly out: bigint;
}

/**
 * The only venue capability the algorithm needs. Implementations are read-only and evaluate every
 * call against the same pinned pool snapshot, so the results are a pure function of their input.
 * `null` means the venue could not quote that size (no liquidity, no route, SDK refusal).
 */
export interface QuoteEngine {
  /** Exact-input quote-token (USDC) to base-token swap. */
  buy(quoteIn: bigint): Quote | null;
  /** Exact-input base-token to quote-token (USDC) swap. */
  sell(baseIn: bigint): Quote | null;
}

export type MeasurementErrorCode =
  | "BuyProbeUnavailable"
  | "SellProbeUnavailable"
  | "InvalidProbe"
  | "InvalidBand"
  | "DuplicatePosition";

/**
 * A measurement that cannot be produced. Never a compliance verdict: callers map it to an
 * `Unavailable` epoch (docs/PRD.md section 6.9), not to non-compliance.
 */
export class MeasurementError extends Error {
  override readonly name = "MeasurementError";
  readonly code: MeasurementErrorCode;

  constructor(code: MeasurementErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.code = code;
  }
}
