# ADR 0008: Token-2022 and position-ownership policy for measurement

- Status: **proposed. Needs product-owner confirmation** for the money-affecting parts (marked below)
- Date: 2026-09-20

## Context (verified live, see `docs/research/current-market.md`)

The PreStocks mints are Token-2022 with `permanentDelegate`, `defaultAccountState`, `transferFeeConfig` (100 bps now, 50 bps before), `confidentialTransferMint`, `confidentialTransferFeeConfig`, `transferHook` (program currently unset), `scaledUiAmountConfig` (multiplier 1.4861347), `metadataPointer`, `pausableConfig` (currently unpaused), `tokenMetadata`, plus a **freeze authority**. Every one of those authorities is a single key controlled by the issuer. Meteora's documentation says mints with a freeze authority or these sensitive extensions need a manual **token badge**; the existing pools prove Meteora has granted it.

Meteora positions (`PositionV2`) carry separate `owner`, `operator` and `fee_owner` fields, can be resized up to 1,400 bins, may be time-locked, and the SDK also has rebalance and limit-order concepts.

## Decisions (measurement layer; no program change needed)

1. **Raw units only.** All measurement and settlement use raw token amounts. `scaledUiAmountConfig` means UI amounts differ from raw by a multiplier the issuer can change (observed: pool raw price 1654.90 USDC per raw token = 1113.57 per UI token x 1.4861347). UI code must apply the multiplier explicitly and label which unit it shows. Never mix them.
2. **Evidence records mint state.** Every observation records the base mint's extension state, transfer-fee epoch schedule, hook program id, pause flag, and scaled-UI multiplier alongside the SDK version.
3. **Fail closed, and never call it non-compliance.** If the base mint is paused, a transfer-hook program becomes set, the freeze/permanent-delegate state changes such that swaps cannot be quoted, or the SDK cannot quote, the observation is *unobservable*. That maps to the existing **`Unavailable`** epoch state (PRD 6.9), never `NonCompliant`.
4. **Transfer fees are part of executable quality.** Quotes must use the SDK's fee-aware handling (`calculateTransferFeeExcludedAmount` / `IncludedAmount` are exported). Whether the spread metric should include transfer fees is verified empirically in Prompt 3 and documented in `docs/methodology/`.
5. **Position ownership (v1).** A registered position counts only if `owner == accepted provider` under the pinned SDK/program. `operator` and `fee_owner` are recorded in the evidence. A position whose owner is not the provider is rejected, even if the provider is its operator.

## Needs the product owner

- **Operator-managed positions** (point 5): should a provider-controlled *operator* on a third party's position ever count? Default is no; it fails closed. AGENTS.md lists unmappable position ownership as a stop-and-ask item.
- **Issuer-controlled pause/freeze during a mandate** (point 3): an issuer pause makes epochs `Unavailable`, which by v1 policy refunds the sponsor and pays the provider nothing. Because the sponsor may be the issuer, a sponsor could in principle trigger a pause to avoid paying. This must be disclosed to providers before bidding and is a candidate for the "stronger provider protection" open decision in EDGE_CASES section 7.
