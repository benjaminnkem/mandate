# Current market evidence: PreStocks / USDC on Meteora DLMM

- Researched: 2026-09-20 (UTC), Solana mainnet-beta, slot ~448,773,245
- Network: **mainnet-beta (read-only)**. Nothing here was signed or sent.
- Reproduce with the commands at the bottom. The public RPC was used for these one-off reads only; services are forbidden from using it on mainnet by config validation.

## Selected market

| Field | Value |
| --- | --- |
| Asset | OPENAI PreStocks |
| Base mint (token X) | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` |
| Quote mint (token Y) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC, classic SPL Token, 6 decimals) |
| Pool | `4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH` |
| DLMM program | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` (pool account owner, and in the SDK's `LBCLMM_PROGRAM_IDS`) |
| Orientation | base = X, quote = USDC = Y (verified by the SDK from `lbPair`) |
| Bin step | 50 bps |
| Base fee | 0.75% (data API) |
| Active bin id | 101; raw price 1654.90 USDC per raw base token |
| TVL / 24h volume | about 157k USD / about 249k USD (data API, discovery only) |
| SDK | `@meteora-ag/dlmm` 1.9.14, loaded through CJS (ADR 0005) |

Why this pool: it is the deepest and most active PreStocks/USDC DLMM pool by TVL and volume of all 112 candidates the data API returned across the 8 PreStocks assets, and the SDK verified it onchain (official program, exact mints, expected orientation). Every other pool that appeared was below 90k TVL; many are empty spam.

Runner-up candidates (same verification path applies before use): ANTHROPIC `2ZFSKYNYsgxmLDiKd9bFPh17fV7c9bdGkGYF8AEMhmpq` (about 42k TVL, 0.3% base fee) and `9thgWVMJUKiiotrVmzhEy1MWPyvkNsUSwKbp8ZFsuhA2` (about 40k TVL, 0.15% base fee, about 308k 24h volume), NEURALINK `GhznDwSWioFirbyAJY5GWpwcfN4NNR2KPY9Q9XPHT8Ry`, ANDURIL `DZwJYn5ZgC3ZzJPjdzLnpufr3YHJ8PveNyXomzoh1Md4`. OPENAI has a second pool, `Y6wSJPjw...QfNYe` (about 22k TVL, 0.01% base fee).

## PreStocks mints are unusually powerful Token-2022 tokens

Base mint owner program: Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), 9 decimals, raw supply 1,901,881,333,714. Mint and freeze authority: `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`.

| Extension | State |
| --- | --- |
| `permanentDelegate` | delegate `WV9P...5Wc` (can move/burn any holder's tokens) |
| `defaultAccountState` | `initialized` |
| `transferFeeConfig` | **100 bps now (epoch 1039), 50 bps before (epoch 1032)**, maximumFee = u64 max (no cap); authority `WV9P...5Wc`; withheld 595,024,041 raw |
| `confidentialTransferMint` / `confidentialTransferFeeConfig` | enabled, authority `WV9P...5Wc`, `harvestToMintEnabled` |
| `transferHook` | `programId: null` (inactive now), authority `WV9P...5Wc` can set one |
| `scaledUiAmountConfig` | multiplier 1.4861347; authority `WV9P...5Wc` |
| `pausableConfig` | `paused: false`; authority `WV9P...5Wc` can pause all transfers |
| `metadataPointer`, `tokenMetadata` | self-referential metadata |

The same key controls freeze, pause, fees, hook, multiplier and permanent delegation. That key can therefore make swaps in this pool fail or change effective fees mid-mandate.

### Verified relationship between raw and UI units

- PreStocks API `supply` for OPENAI = 2,826.45; raw mint supply / 1e9 = 1,901.88; ratio = 1.48613 = the scaled-UI multiplier. The API reports UI-scaled amounts.
- SDK active-bin raw price 1654.90 / 1.4861347 = 1113.57 USDC per UI token, which equals the data API's `current_price`. The pool works in raw units; UI prices are divided by the multiplier.
- PreStocks `tokenPrice` 1151.23 and `markPrice` 995.47 are context only and never settlement inputs (PRD 6.7). They differ from the pool by a few percent, which is expected and not a bug.

## Measured with the canonical engine (Prompt 3)

Network: **mainnet-beta, read-only**, one atomic snapshot at slot 448,786,149 (Solana epoch 1038, unix ts 1789921836).
Recorded as a fixture: `packages/meteora/test/fixtures/openai-usdc-mainnet.snapshot.json`; replaying it offline
reproduces every number and the payload hash exactly (`docs/methodology/measurement-v1.md`).

| Metric (probe 10 USDC, band 500 bps) | Value |
| --- | --- |
| Probe round trip | 10.000000 USDC buys 5,937,659 raw base; selling it back returns 9.752300 USDC (`Q0=10000000`, `B0=5937659`, `S0=9752300`) |
| Effective spread | **251 bps** |
| Pool buy depth within 500 bps | 63,491.02 USDC |
| Pool sell depth within 500 bps | 49,065.54 USDC |
| Real provider (`2Kmm...jak`, 3 positions), quote in band | 91.107867 USDC |
| Same provider, base in band, quote-equivalent | 81.314309 USDC (48,887,131 raw base) |

### What this verified

1. **The PRD's 100 bps example was unachievable.** The 251 bps is 2 x 0.75% pool fee plus 2 x 0.50% transfer fee. The example is now 400 bps with a note in the PRD.
2. **The transfer fee changes at the next Solana epoch.** Epoch 1038 uses the older 50 bps schedule; the mint's newer 100 bps schedule takes effect at epoch 1039, when the same round trip will cost about 351 bps. A mandate spanning that boundary sees its spread jump by about 100 bps with no change in provider behaviour. Sponsors and providers must be told; thresholds set today from a 251 bps reading would fail across the boundary.
3. **Quotes are transfer-fee aware on both legs** (SDK source and live check), so the spread needs no manual fee adjustment.
4. **Attribution works on real accounts.** Three positions owned by the provider counted; a position owned by another wallet was excluded (`ExcludedOwnerMismatch`); a non-existent address was excluded (`ExcludedMissing`).
5. **Operator-managed positions were not seen.** The pool has 110 `PositionV2` accounts; in the 14 whose fields were inspected the `operator` was unset, so the operator-managed case in ADR 0008 has not been observed here (the other 96 were not inspected).
6. **A 10,000,000 USDC probe is refused** by the pool as insufficient liquidity and surfaces as `BuyProbeUnavailable`, never as a metric.
7. The public Solana RPC served a coherent atomic read but with an 11-slot skew across the SDK's separate reads, which is why observations use one atomic request (ADR 0010).

### Still open

- `probe_quote_raw` sizing: the active bin holds about 3,614 USDC raw `3613606772` and 27,463,399 raw base at the earlier snapshot; a 10 USDC probe stays inside one bin, so it measures fee-dominated spread rather than depth. A larger probe mixes spread with depth. The recommended default is left to the product owner; the algorithm accepts any probe within the protocol bounds.
- Cross-OS determinism has only been run on macOS. The golden-hash test runs on the Linux CI job.

## Verification of the mint set

`GET https://prestocks.com/api/prestocks` returned 8 assets (ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX), each with a `contract_address`. Only OPENAI's mint has been inspected onchain so far. **No market is approved.** Approval is an explicit admin step (TECHNICAL_SPEC 17) and the other seven mints must each be inspected before use.

## Reproduce

```bash
export SOLANA_RPC_HTTP_URL=<mainnet rpc>
pnpm --filter @mandate/scripts inspect:prestocks -- --symbol OPENAI
pnpm --filter @mandate/scripts market:discover -- --symbol OPENAI --min-tvl 20000
```
