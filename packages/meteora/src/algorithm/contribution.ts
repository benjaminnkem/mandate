import { MeasurementError } from "./types.ts";

export interface PositionBinAmounts {
  readonly binId: number;
  /** Raw amount of token X this position holds in the bin. */
  readonly xAmount: bigint;
  /** Raw amount of token Y this position holds in the bin. */
  readonly yAmount: bigint;
}

/** A registered position after it has been read (or found missing) from chain state. */
export type PositionInput =
  | {
      readonly kind: "loaded";
      readonly address: string;
      readonly lbPair: string;
      readonly owner: string;
      readonly operator: string;
      readonly feeOwner: string;
      readonly lowerBinId: number;
      readonly upperBinId: number;
      readonly bins: readonly PositionBinAmounts[];
    }
  | { readonly kind: "missing"; readonly address: string }
  /** The account exists but is not a supported DLMM position (fail closed, docs/adr/0008). */
  | { readonly kind: "invalid"; readonly address: string; readonly reason: string };

export type PositionVerdict =
  | "Counted"
  | "ExcludedMissing"
  | "ExcludedNotAPosition"
  | "ExcludedWrongPool"
  | "ExcludedOwnerMismatch";

export interface PositionContribution {
  readonly address: string;
  readonly verdict: PositionVerdict;
  readonly owner: string | null;
  readonly operator: string | null;
  readonly feeOwner: string | null;
  readonly lowerBinId: number | null;
  readonly upperBinId: number | null;
  /** Whether the position's range includes the active bin. */
  readonly coversActiveBin: boolean;
  readonly binsInBand: number;
  readonly quoteInBandRaw: bigint;
  readonly baseInBandRaw: bigint;
}

export interface ProviderContribution {
  readonly quoteInBandRaw: bigint;
  readonly baseInBandRaw: bigint;
  readonly perPosition: readonly PositionContribution[];
}

export interface ContributionInput {
  readonly positions: readonly PositionInput[];
  readonly pool: string;
  readonly provider: string;
  /** True when the base (PreStocks) token is the pool's token X. */
  readonly baseIsX: boolean;
  readonly activeId: number;
  readonly lowerBinId: number;
  readonly upperBinId: number;
}

/**
 * Sum the accepted provider's registered positions inside the band, by token side.
 *
 * Attribution rules (ADR 0008): a position counts only if it belongs to the selected pool and its
 * `owner` equals the accepted provider. Missing, wrong-pool and wrong-owner positions contribute
 * exactly zero and are recorded with the reason, so a verifier can see why. A duplicated registered
 * address is a corrupted input and is rejected outright rather than counted once or twice.
 * Amounts are raw per-bin holdings as reported by the official SDK; nothing is estimated.
 */
export function computeProviderContribution(input: ContributionInput): ProviderContribution {
  const seen = new Set<string>();
  for (const position of input.positions) {
    if (seen.has(position.address))
      throw new MeasurementError("DuplicatePosition", position.address);
    seen.add(position.address);
  }

  let quoteInBandRaw = 0n;
  let baseInBandRaw = 0n;
  const perPosition: PositionContribution[] = [];

  for (const position of input.positions) {
    if (position.kind === "missing") {
      perPosition.push(excluded(position.address, "ExcludedMissing", null));
      continue;
    }
    if (position.kind === "invalid") {
      perPosition.push(excluded(position.address, "ExcludedNotAPosition", null));
      continue;
    }
    if (position.lbPair !== input.pool) {
      perPosition.push(excluded(position.address, "ExcludedWrongPool", position));
      continue;
    }
    if (position.owner !== input.provider) {
      perPosition.push(excluded(position.address, "ExcludedOwnerMismatch", position));
      continue;
    }
    let quote = 0n;
    let base = 0n;
    let binsInBand = 0;
    for (const bin of position.bins) {
      if (bin.binId < input.lowerBinId || bin.binId > input.upperBinId) continue;
      binsInBand += 1;
      const baseAmount = input.baseIsX ? bin.xAmount : bin.yAmount;
      const quoteAmount = input.baseIsX ? bin.yAmount : bin.xAmount;
      base += baseAmount;
      quote += quoteAmount;
    }
    quoteInBandRaw += quote;
    baseInBandRaw += base;
    perPosition.push({
      address: position.address,
      verdict: "Counted",
      owner: position.owner,
      operator: position.operator,
      feeOwner: position.feeOwner,
      lowerBinId: position.lowerBinId,
      upperBinId: position.upperBinId,
      coversActiveBin:
        position.lowerBinId <= input.activeId && input.activeId <= position.upperBinId,
      binsInBand,
      quoteInBandRaw: quote,
      baseInBandRaw: base,
    });
  }
  return { quoteInBandRaw, baseInBandRaw, perPosition };
}

function excluded(
  address: string,
  verdict: PositionVerdict,
  position: Extract<PositionInput, { kind: "loaded" }> | null,
): PositionContribution {
  return {
    address,
    verdict,
    owner: position?.owner ?? null,
    operator: position?.operator ?? null,
    feeOwner: position?.feeOwner ?? null,
    lowerBinId: position?.lowerBinId ?? null,
    upperBinId: position?.upperBinId ?? null,
    coversActiveBin: false,
    binsInBand: 0,
    quoteInBandRaw: 0n,
    baseInBandRaw: 0n,
  };
}

/**
 * Convert a base-token amount to quote-equivalent using the probe midpoint, for measurement
 * normalisation only (never a fair-value claim):
 *
 *     floor(base * (Q0 + S0) / (2 * B0))
 */
export function baseToQuoteEquivalent(baseRaw: bigint, q0: bigint, s0: bigint, b0: bigint): bigint {
  if (b0 <= 0n) throw new MeasurementError("InvalidProbe", "zero base probe");
  return (baseRaw * (q0 + s0)) / (2n * b0);
}
