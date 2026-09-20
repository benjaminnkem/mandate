import type { EpochMetrics, Thresholds } from "./types.ts";

export const COMPLIANCE_FAILURES = [
  "SpreadTooWide",
  "PoolBuyDepthTooLow",
  "PoolSellDepthTooLow",
  "ProviderQuoteInBandTooLow",
  "ProviderBaseInBandTooLow",
] as const;
export type ComplianceFailure = (typeof COMPLIANCE_FAILURES)[number];

export interface ComplianceResult {
  readonly compliant: boolean;
  /** Every failed metric, in fixed order, so the UI can always explain a non-compliant epoch. */
  readonly failures: readonly ComplianceFailure[];
}

/**
 * The binary per-epoch predicate from docs/TECHNICAL_SPEC.md section 6.12. All comparisons are on
 * integers; equality passes. Every metric must pass.
 */
export function evaluateCompliance(
  metrics: EpochMetrics,
  thresholds: Thresholds,
): ComplianceResult {
  const failures: ComplianceFailure[] = [];
  if (metrics.effectiveSpreadBps > thresholds.maxEffectiveSpreadBps) failures.push("SpreadTooWide");
  if (metrics.poolBuyDepthQuoteRaw < thresholds.minPoolBuyDepthQuoteRaw)
    failures.push("PoolBuyDepthTooLow");
  if (metrics.poolSellDepthQuoteRaw < thresholds.minPoolSellDepthQuoteRaw)
    failures.push("PoolSellDepthTooLow");
  if (metrics.providerQuoteInBandRaw < thresholds.minProviderQuoteInBandRaw)
    failures.push("ProviderQuoteInBandTooLow");
  if (metrics.providerBaseQuoteEqInBandRaw < thresholds.minProviderBaseQuoteEqInBandRaw) {
    failures.push("ProviderBaseInBandTooLow");
  }
  return { compliant: failures.length === 0, failures };
}
