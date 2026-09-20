# Measurement methodology, algorithm version 1

This is the reader-facing definition of what Mandate measures. The normative specification is
`docs/TECHNICAL_SPEC.md` section 7; the reference implementation is `packages/meteora/src/algorithm/`. Every
number below can be reproduced from a stored snapshot with no network access (see "Reproduce").

## What is measured

Mandate measures execution quality on one exact Meteora DLMM pool. It does **not** claim the pool's price is
fair, correct, or safe.

| Metric | Definition |
| --- | --- |
| Effective spread (bps) | `ceil(2 * abs(Q0 - S0) * 10000 / (Q0 + S0))`. `Q0` USDC buys `B0` base; selling exactly `B0` back returns `S0`. It is a **probe round trip**, not a CLOB bid/ask. It includes the pool fee and any Token-2022 transfer fee on both legs. |
| Pool buy depth (USDC) | The largest USDC input that is **fully consumed** and whose average price stays within `depth_band_bps` of the baseline buy price. |
| Pool sell depth (USDC) | The USDC output of the largest base input that is fully consumed and whose average price stays within `depth_band_bps` of the baseline sell price. |
| Provider quote in band | USDC raw held by the provider's registered positions in bins inside the price band around the active bin. |
| Provider base in band | Base raw held by those positions in the same bins, converted to USDC-equivalent as `floor(base * (Q0 + S0) / (2 * B0))`, for normalisation only. |

All comparisons are exact integer cross-multiplications:

- buy candidate `Q` producing `B` passes iff `Q * B0 * 10000 <= Q0 * B * (10000 + band)`
- sell candidate `B` producing `S` passes iff `S * B0 * 10000 >= S0 * B * (10000 - band)`

The SDK's floating-point `priceImpact` is never used.

## The band, in bins

DLMM bin `i` has price `(1 + binStep/10000)^i`. The band around the active bin is the inclusive bin range
`[active - binsBelow, active + binsAbove]` where `binsAbove` is the largest `k` with `r^k <= (10000+band)/10000`
and `binsBelow` the largest `k` with `r^-k >= (10000-band)/10000`, `r = (10000+binStep)/10000`, computed with
big integers. A bin exactly on the boundary is inside.

## Attribution

A registered position counts only if it is a `PositionV2` of the selected pool whose `owner` equals the accepted
provider. Anything else contributes exactly zero and is recorded with its reason: `ExcludedMissing`,
`ExcludedNotAPosition`, `ExcludedWrongPool`, `ExcludedOwnerMismatch`. `operator` and `fee_owner` are recorded but
do not confer ownership (ADR 0008). A duplicated registered address is rejected outright. An *unreadable* position
is never treated as empty: it makes the whole observation unobservable.

## Search procedure (fixed by the algorithm version)

Exponential growth by a factor of 2 from the baseline to bracket the boundary (at most 48 steps, cap 10^14 raw),
then integer binary search to a bracket of 1 raw unit (at most 64 iterations). The result is defined as what this
procedure returns; its `pass(x)` / `fail(x+1)` bracket is recorded in the evidence. At tiny scales rounding can
make the predicate non-monotone; at real raw-unit scales it is negligible.

## Determinism: how one observation becomes reproducible

1. **Atomic snapshot.** The accounts a measurement needs are discovered, then fetched in one
   `getMultipleAccounts` request, so all of them come from one slot (skew 0). Reads spanning more than 12 slots are
   rejected.
2. **Pure computation.** The measurement runs against that snapshot only, through the pinned official SDK.
3. **Pinned clock.** The SDK's `swapQuote` reads the wall clock to decay the volatility accumulator, so the same
   accounts can quote differently at different times. Every quote runs with the clock pinned to the snapshot's own
   on-chain Clock timestamp.
4. **Canonical evidence.** The result is serialised as canonical JSON (sorted keys, integers and decimal strings
   only) and hashed with SHA-256. Observer-specific transport metadata is outside the payload hash.

## What is not measured

Fair value, whether a compliant market is safe to trade, sustainability past the measured epochs, or anything about
the issuer. Compliance means thresholds were met at the observed snapshot.

## Token-2022 specifics for PreStocks

PreStocks mints carry transfer fees, pausing, a transfer-hook slot, a scaled UI multiplier and a permanent delegate,
all controlled by one issuer key. Measurement records the fee schedule in force at the observation epoch and refuses
to measure (unobservable, never non-compliant) when the mint is paused or a hook is active. All amounts are raw units;
UI amounts differ by the scaled-UI multiplier. See `docs/adr/0008-token2022-and-position-ownership-policy.md`.

## Reproduce

```bash
# Live: read-only, needs a mainnet RPC. Records the snapshot.
SOLANA_RPC_HTTP_URL=<rpc> pnpm market:measure --pool <pool> --base-mint <mint> --provider <wallet> \
  --positions <p1,p2> --probe 10000000 --band 500 --record snapshot.json

# Offline: re-run from the snapshot. The payload hash must be identical.
pnpm market:measure --pool <pool> --base-mint <mint> --provider <wallet> \
  --positions <p1,p2> --probe 10000000 --band 500 --replay snapshot.json
```
