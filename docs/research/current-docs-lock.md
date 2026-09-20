# Current docs lock

Every external source checked for Prompt 1, when, what was concluded, and what is still unresolved. Checked 2026-09-20 (UTC). "Normative" means the project's behaviour must follow it; "informative" means it is context only.

| Source | Checked | Conclusion used | Kind |
| --- | --- | --- | --- |
| https://hackathons.solana.com/hackathons/stocklana | live page fetched | Submissions close **Friday 25 September 2026, 4:00 pm ET**; judging through 2 October; 750 registered, 135 submissions; one submission per team, GitHub/demo/video link required | normative |
| Same page, PreStocks bounty | live | $10k, three winners; "projects that integrate any non-PreStocks pre-IPO tokens will be ineligible". Tessera (a separate $6k bounty) is exactly about non-PreStocks pre-IPO tokens, so **Mandate must not touch Tessera tokens** | normative |
| Same page, Clawpump bounty | live | Requirement: launch a token with a stock-paired liquidity pool using Clawpump and Meteora. Not a core dependency; remains gated (Prompt 14) | normative |
| Same page, Meteora bounty | live | Best use of **DBC** specifically; ordinary DLMM use does not qualify | normative |
| Same page, Pyth bounty | live | Excluded by product-owner decision | normative |
| https://prestocks.com/api/prestocks | live GET | 8 assets, schema matches `@mandate/prestocks` (zod, fail closed). `supply` is UI-scaled by the mint's scaled-UI multiplier | normative |
| Solana mainnet-beta via public RPC | live | OPENAI mint, USDC mint, pool account inspected (see current-market.md) | normative |
| https://docs.meteora.ag/llms.txt | live | Docs index available; MCP at `https://docs.meteora.ag/mcp` | informative |
| docs.meteora.ag DLMM Token 2022 Support | read | Permissionless extensions are only TransferFee, MetadataPointer, TokenMetadata and revoked TransferHook. Freeze authority or sensitive extensions need a manual token badge | normative |
| docs.meteora.ag DLMM Dynamic Positions | read | `PositionV2`; separate owner, operator, fee owner; resizable to 1,400 bins; lockable | normative |
| `@meteora-ag/dlmm` 1.9.14 type declarations | read | `DLMM.create`, `getActiveBin`, `getBinArrayForSwap`, `swapQuote(inAmount, swapForY, allowedSlippage, binArrays, isPartialFill?, maxExtraBinArrays?)`, `getPosition`, `getPositionsByUserAndLbPair`, `calculateTransferFeeExcludedAmount`, `getExtraAccountMetasForTransferHook`, `LBCLMM_PROGRAM_IDS` | normative |
| Same SDK, runtime | executed | ESM entry unusable under native Node; CJS `module.exports` is the class (ADR 0005) | normative |
| npm registry | live | dlmm 1.9.14, web3.js 1.99.0, next 16.3.5, react 19.3.0, zod 4.6.5, pino 10.3.1, fastify 5.12.5, vitest 5.0.1, drizzle-orm 0.45.2, bullmq 6.3.8, typescript 7.0.2 latest / 6.0.3 used | informative |
| GitHub `solana-foundation/anchor` releases | live | Stable 1.2.0 (2026-09-04); 0.32.2 / 0.31.2 / 0.30.2 patch releases; `v2.0.0-rc.1` prerelease. Using 1.2.0 | normative |
| https://release.anza.xyz/stable | installed | Agave / solana-cli 4.2.2 | normative |
| GitHub `txtx/surfpool` releases | live | 1.6.0, darwin-x64 build installed | normative |

## Unresolved material issues

1. **TypeScript 7 is not usable with typescript-eslint yet** (ADR 0001). Staying on 6.0.3.
2. **Third-party unmet peers** reported by `pnpm peers check`: `@solana/codecs-numbers|core|errors@5.5.1` want TypeScript ^5 (type-only); `ws@7.5.13` wants optional `utf-8-validate`. Neither affects runtime behaviour. Re-check on dependency bumps.
3. **PreStocks mints are highly privileged Token-2022 tokens** (freeze, pause, hook, fee and multiplier authorities all held by one key). ADR 0008 is *proposed* and two points need product-owner input.
4. **The PRD's 100 bps example spread is probably unachievable** given 75 bps pool fee per leg plus a 100 bps transfer fee. Verified in Prompt 3, not assumed.
5. **Not yet done, deliberately:** Surfpool was installed but a fork has not been started (Prompt 13 uses it; a smoke start belongs with Prompt 3 measurement); Clawpump `/pump-pairs` and its docs were not verified because no credentials exist and it is gated; Solana developer MCP and Meteora docs MCP are not registered in this environment, so the Meteora docs were read directly over HTTPS. Meteora "DLMM Formulas", "Collect Fee Mode" and the API reference will be read at the start of Prompt 3.
6. The remaining seven PreStocks mints have **not** been inspected onchain. Only OPENAI has.
7. The public Solana RPC is rate-limited. Prompt 3 and later need a dedicated provider (or Surfpool) for repeated measurement runs.
