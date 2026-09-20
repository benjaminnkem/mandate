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

## Implications for the specification (open, verify in Prompt 3)

1. **The PRD's example spread threshold of 100 bps is very likely unachievable on this pool.** Round-trip spread includes the pool fee on each leg (0.75% x 2 = 150 bps) and possibly the 1% transfer fee on the base token on each leg (up to about 200 bps more). Realistic thresholds may be roughly 200 to 400 bps. Prompt 3 measures the real number; PRD and UI defaults must not present 100 bps as an example without that check. Never label a default "safe".
2. `probe_quote_raw` must be sized against a pool where the active bin holds about 3,614 USDC (raw `3613606772`) and 27,463,399 raw base: a probe larger than the active bin already crosses bins and mixes spread with depth.
3. Position ownership, operator handling, pause and hook handling are recorded in ADR 0008 and need product-owner confirmation on two points.

## Verification of the mint set

`GET https://prestocks.com/api/prestocks` returned 8 assets (ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX), each with a `contract_address`. Only OPENAI's mint has been inspected onchain so far. **No market is approved.** Approval is an explicit admin step (TECHNICAL_SPEC 17) and the other seven mints must each be inspected before use.

## Reproduce

```bash
export SOLANA_RPC_HTTP_URL=<mainnet rpc>
pnpm --filter @mandate/scripts inspect:prestocks -- --symbol OPENAI
pnpm --filter @mandate/scripts market:discover -- --symbol OPENAI --min-tvl 20000
```
