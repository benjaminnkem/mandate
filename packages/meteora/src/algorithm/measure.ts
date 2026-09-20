import { bandBinRange, type BinBand } from "./band.ts";
import { SEARCH_CAP_QUOTE_RAW } from "./constants.ts";
import {
  baseToQuoteEquivalent,
  computeProviderContribution,
  type PositionInput,
  type ProviderContribution,
} from "./contribution.ts";
import { evaluateBuy, evaluateSell, searchMaxPassing, type BoundaryProof } from "./search.ts";
import { effectiveSpreadBps } from "./spread.ts";
import { MeasurementError, type QuoteEngine } from "./types.ts";

export interface MeasureInput {
  readonly engine: QuoteEngine;
  /** The mandate's probe size `Q0`, quote (USDC) raw units. */
  readonly probeQuoteRaw: bigint;
  /** The mandate's depth / impact band, in bps. */
  readonly depthBandBps: bigint;
  readonly pool: string;
  readonly provider: string;
  readonly baseIsX: boolean;
  readonly activeId: number;
  readonly binStep: number;
  readonly positions: readonly PositionInput[];
}

/** The five integer metrics settlement compares against thresholds. */
export interface QualityMetrics {
  readonly effectiveSpreadBps: number;
  readonly poolBuyDepthQuoteRaw: bigint;
  readonly poolSellDepthQuoteRaw: bigint;
  readonly providerQuoteInBandRaw: bigint;
  readonly providerBaseQuoteEqInBandRaw: bigint;
}

export interface Measurement {
  readonly metrics: QualityMetrics;
  readonly probe: { readonly q0: bigint; readonly b0: bigint; readonly s0: bigint };
  readonly band: BinBand;
  readonly buyDepth: BoundaryProof;
  readonly sellDepth: BoundaryProof;
  readonly provider: ProviderContribution;
  /** Provider base-token holdings inside the band, before quote-equivalent conversion. */
  readonly providerBaseInBandRaw: bigint;
}

/**
 * Canonical measurement, algorithm version 1 (docs/TECHNICAL_SPEC.md section 7).
 *
 *  1. Buy probe `Q0 -> B0`, then sell probe `B0 -> S0`, both on the same snapshot, both fully consumed.
 *  2. Effective spread from `Q0` and `S0`.
 *  3. Maximum fully consumable buy input inside the impact band (exact cross-multiplied comparison).
 *  4. Maximum fully consumable sell input inside the impact band; reported as its USDC output.
 *  5. Provider in-band quote holdings and base holdings converted at the probe midpoint.
 *
 * Throws `MeasurementError` when no valid measurement exists. That is never a compliance verdict.
 */
export function measureQuality(input: MeasureInput): Measurement {
  const { engine, probeQuoteRaw: q0, depthBandBps: band } = input;
  if (q0 <= 0n) throw new MeasurementError("InvalidProbe", "probe must be positive");

  const buyProbe = engine.buy(q0);
  if (buyProbe === null || buyProbe.consumedIn !== q0 || buyProbe.out <= 0n) {
    throw new MeasurementError("BuyProbeUnavailable");
  }
  const b0 = buyProbe.out;

  const sellProbe = engine.sell(b0);
  if (sellProbe === null || sellProbe.consumedIn !== b0 || sellProbe.out <= 0n) {
    throw new MeasurementError("SellProbeUnavailable");
  }
  const s0 = sellProbe.out;

  const spread = effectiveSpreadBps(q0, s0);

  const buyDepth = searchMaxPassing(q0, SEARCH_CAP_QUOTE_RAW, (candidate) =>
    evaluateBuy(engine, q0, b0, band, candidate),
  );

  // The sell search cap is the base amount worth `SEARCH_CAP_QUOTE_RAW` at the buy-probe price.
  const capBaseRaw = maxBigInt(b0, (SEARCH_CAP_QUOTE_RAW * b0) / q0);
  const sellDepth = searchMaxPassing(b0, capBaseRaw, (candidate) =>
    evaluateSell(engine, b0, s0, band, candidate),
  );

  const bandBins = bandBinRange(input.activeId, input.binStep, band);
  const provider = computeProviderContribution({
    positions: input.positions,
    pool: input.pool,
    provider: input.provider,
    baseIsX: input.baseIsX,
    activeId: input.activeId,
    lowerBinId: bandBins.lowerBinId,
    upperBinId: bandBins.upperBinId,
  });

  return {
    metrics: {
      effectiveSpreadBps: Number(spread),
      poolBuyDepthQuoteRaw: buyDepth.passingInput,
      poolSellDepthQuoteRaw: sellDepth.passingOut,
      providerQuoteInBandRaw: provider.quoteInBandRaw,
      providerBaseQuoteEqInBandRaw: baseToQuoteEquivalent(provider.baseInBandRaw, q0, s0, b0),
    },
    probe: { q0, b0, s0 },
    band: bandBins,
    buyDepth,
    sellDepth,
    provider,
    providerBaseInBandRaw: provider.baseInBandRaw,
  };
}

const maxBigInt = (a: bigint, b: bigint): bigint => (a > b ? a : b);
