# Mandate — Research and Source of Truth

**Last researched:** 2026-09-20.  
**Rule:** implementation agents must re-open current official documentation before coding any external integration. This document is a starting point, not permission to rely on stale SDK assumptions.

## 1. Stocklana

Official page: https://hackathons.solana.com/hackathons/stocklana

At the time this document was prepared, the live page showed 749 registered builders, 135 submissions, five sponsor tracks and $126K total prizes. These counts can change and are not product requirements.

Stable strategic facts to verify again before submission:

- Main prize pool: $100K.
- Current submission deadline shown during research: **September 25, 2026, 4:00 PM ET**.
- Highlighted product directions include trading/markets, investing/portfolios, credit/yield, data/infrastructure and consumer products.
- Official guidance emphasizes a narrow product that works end-to-end over a broad demo.
- The judging lens includes: real user/problem, working product, Solana-native rationale and execution quality.
- A team may select sponsor tracks in addition to the main track, subject to each sponsor's requirements.

### Sponsor constraints relevant to Mandate

#### PreStocks

- Stocklana bounty displayed: $10K.
- Projects integrating **competing non-PreStocks pre-IPO tokens** are ineligible for the PreStocks bounty. Treat this as a strict product constraint for sponsor-eligible builds.
- The bounty explicitly welcomes lending/collateral and other new financial primitives.

#### Tessera

Not a core dependency of Mandate. Do not add it just to increase sponsor count.

#### Clawpump

- Stocklana bounty displayed: $5K.
- The sponsor requirement is not satisfied by merely calling an agent API. The current bounty asks the project to launch its token with a **stock-paired liquidity pool using Clawpump and Meteora**.
- Therefore Mandate treats Clawpump as a **gated extension** after the core product works.

#### Meteora

- Stocklana bounty displayed: $5K.
- The bounty specifically focuses on **Dynamic Bonding Curve (DBC)** innovation.
- Merely using a normal Meteora DLMM/DAMM pool does not make a project a DBC-bounty submission.
- Mandate's core product uses Meteora as a venue. An optional “Launch Mandate” extension can pursue the DBC bounty only if DBC configuration/migration is genuinely part of the product.

#### Pyth

Intentionally excluded from both project plans by product-owner decision. Do not reintroduce Pyth as a default dependency.

---

## 2. PreStocks

Official site: https://prestocks.com/  
Public product API: https://prestocks.com/api/prestocks

### Public API observed during research

The API returned live objects with fields including:

```text
name
symbol
description
image
external_url
contract_address
markPrice
markValuation
tokenPrice
impliedValuation
supply
```

Products visible during research included ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET and SPACEX.

The observed OPENAI Solana mint was:

```text
PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF
```

**Never hardcode this as eternally canonical.** Resolve current product metadata from the live API and confirm the mint onchain before enabling it in a production allowlist.

### Product/legal semantics that affect engineering

PreStocks describes its products as economic exposure through SPV/private-company exposure. It explicitly states that holders do **not** receive ordinary underlying-company ownership, voting, dividend, information or other shareholder rights. Secondary liquidity is not guaranteed, and availability is restricted in certain jurisdictions including U.S. persons.

Engineering consequences:

- UI copy must not call a PreStock token “a share of OpenAI” without qualification.
- Market eligibility must be based on exact mint addresses and approved asset configuration, not ticker strings.
- Jurisdictional eligibility is not solved by smart contracts. Do not claim permissionless global legal eligibility.
- `markPrice` and `tokenPrice` can be displayed as market context, but **Mandate must never use them as settlement inputs**. Epoch compliance is measured from the selected Meteora pool's own state; see `docs/PRD.md` §6.7.
- Lifecycle events can matter. PreStocks has had products marked “Action Required” with conversion/expiry deadlines. Asset onboarding must therefore include lifecycle-state checks.

### PreStocks integration policy

Mandate implements a small, typed adapter around the public API in `packages/prestocks`. The adapter must:

- validate JSON response shape at runtime;
- cache with explicit timestamps and bounded TTL;
- preserve raw upstream payload for debugging/audit where appropriate;
- fail closed when the upstream schema is invalid;
- expose `asOf`/freshness in product-facing responses;
- never make API presence alone sufficient for onchain support;
- resolve and inspect the returned mint on Solana before enabling money-moving flows.

---

## 3. Solana development baseline

Official docs: https://solana.com/docs  
Official Anchor docs: https://www.anchor-lang.com/docs

### Recommended client stack

Use the current official Solana application stack at implementation time. During research, official templates used:

- `@solana/kit`
- Wallet Standard / current Solana wallet integration
- `@solana/react` in current templates
- Anchor for programs

Avoid starting a new production codebase with deprecated web3/wallet APIs merely because old tutorials use them.

### Anchor

Anchor is appropriate for both onchain programs because it gives explicit account constraints, deterministic account serialization and mature testing tooling.

At implementation time, read current Anchor docs before pinning versions. Useful commands include current equivalents of:

```bash
anchor build
anchor test
anchor verify
```

Use program verification/reproducible build steps before mainnet submission.

### Token-2022

Both products must be Token-2022 aware.

Rules:

- inspect `owner`/token program for every supported mint;
- inspect extensions before enabling an asset;
- use current Anchor token-interface semantics and checked transfers;
- correctly handle decimals;
- inspect TransferHook/TransferFee/PermanentDelegate/ScaledUiAmount/Pausable/freeze-related extensions where present;
- if a Transfer Hook is active, resolve required extra accounts instead of assuming a three-account transfer;
- never use UI-adjusted floating-point balances for settlement-critical raw amounts.

### RPC

Do not depend on public mainnet RPC for production or parallel integration tests. Use a reliable provider with WebSocket support and rate limits suitable for:

- indexer subscription;
- signature backfill;
- transaction simulation;
- account reads;
- mainnet-fork upstream state.

RPC provider choice should remain configurable.

---

## 4. Mainnet-fork testing with Surfpool

Official docs: https://docs.surfpool.run/

Surfpool supports local development against forked Solana state/programs. The implementation agent should re-check the current CLI syntax, but the intended workflow is:

```bash
surfpool start --rpc-url <UPSTREAM_MAINNET_RPC>
```

Use the mainnet fork to test against real:

- token mints and Token-2022 extensions;
- Meteora programs/pools for Mandate;
- USDC mint/account semantics;
- transaction account-size/compute behavior;
- integrations without risking production funds.

A mainnet fork is still not a substitute for the final small mainnet proof. It is the safety stage before it.

Surfpool also exposes MCP tooling. It can be useful to Codex for inspecting/forking current state.

---

## 5. Meteora — Mandate only

Official docs: https://docs.meteora.ag/  
LLM index: https://docs.meteora.ag/llms.txt  
Docs MCP: https://docs.meteora.ag/mcp

Relevant current SDK families discovered during research:

- DLMM: `@meteora-ag/dlmm`
- DAMM v2 / CP-AMM: `@meteora-ag/cp-amm-sdk`
- Dynamic Bonding Curve: `@meteora-ag/dynamic-bonding-curve-sdk`

Mandate must use the **official SDK math/state** for the selected live pool type instead of rewriting AMM formulas from memory.

Before implementation:

1. discover a real approved PreStocks/USDC Meteora market;
2. identify whether it is DLMM or DAMM v2;
3. verify Token-2022 support and required token badges/accounts;
4. reproduce executable buy/sell quotes with official SDK calls;
5. only then implement the venue adapter.

The core Mandate does **not** need to create a new DBC. Optional DBC work is described separately in Mandate documents.

---

## 6. Clawpump — optional Mandate extension

Developer docs: https://clawpump.tech/developers  
General docs: https://clawpump.tech/docs  
REST base: https://clawpump.tech/api/v1  
Launchpad MCP: https://clawpump.tech/api/mcp

Observed integration facts during research:

- Bearer auth uses a `cpk_...` API key.
- Use the apex `clawpump.tech` domain; redirects may drop authorization headers.
- `GET /api/v1/pump-pairs` is the authoritative source for supported custom quote pairs.
- A token appearing in ordinary token search does **not** prove it can be used as a custom launch pair.
- `/portfolio` was documented as currently non-functional; do not build a dependency on it unless current docs say otherwise.
- Some write operations are non-idempotent. Retries must be guarded by operation IDs/state checks rather than blind retries.
- Some operations can take materially longer than ordinary web requests; follow current timeout guidance.

### Mandatory integration gate

Before any Clawpump code becomes part of Mandate's critical path:

1. obtain a current API key;
2. call `/pump-pairs`;
3. confirm that the intended stock/pre-stock quote asset is accepted;
4. verify the exact current Stocklana bounty requirements;
5. run a non-money-moving or minimal preflight using current docs;
6. document custody/creator-wallet behavior precisely.

If the intended pair is unsupported, **do not fake eligibility**. Keep Mandate core independent and omit the bounty.

---

## 7. Source hierarchy

When documentation conflicts, prefer sources in this order:

1. current onchain program/account behavior;
2. current official sponsor/product documentation;
3. current official SDK source/types;
4. current official example repositories;
5. sponsor/community support clarification;
6. third-party tutorials/blogs;
7. model memory.

If a material behavior remains ambiguous after checking 1–5, stop and ask the product owner rather than inventing money-moving behavior.

