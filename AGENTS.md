# Mandate — Agent / Engineer Operating Contract

This file is the first file every coding agent must read before modifying Mandate.

## Mission

Build **Mandate**, a production-oriented market-quality procurement protocol on Solana. A sponsor (issuer, asset community, venue, protocol, treasury, etc.) escrows a USDC reward and publishes a measurable liquidity mandate for one approved Meteora DLMM market. Market makers bid for the mandate. The selected provider registers exact liquidity positions. An auditable observer quorum measures the provider's attributable liquidity contribution and the market's executable two-sided quality at fixed epochs. The provider earns only for epochs that satisfy the mandate.

The project is not a liquidity dashboard and not generic liquidity mining. The central product primitive is:

> **Pay for verified market quality, not merely deposited TVL.**

For Stocklana v1, the primary supported asset family is **PreStocks** paired with USDC on an approved Meteora DLMM pool.

## Read before coding

Read completely, in this order:

1. `docs/RESEARCH_AND_SOURCE_OF_TRUTH.md`
2. `docs/ENGINEERING_STANDARDS.md`
3. `docs/PRD.md`
4. `docs/TECHNICAL_SPEC.md`
5. `docs/EDGE_CASES_AND_OPEN_DECISIONS.md`
6. the current step in `docs/BUILD_PROMPTS.md`

Before touching Meteora or Clawpump integrations, re-read their current official docs using configured MCP/docs resources.

## Documentation map

Every document lives in `docs/`; this file is the only one at the repository root.

| File | Role |
| --- | --- |
| `AGENTS.md` | this operating contract; read first, always |
| `docs/PRD.md` | product requirements, scope lock, acceptance criteria |
| `docs/TECHNICAL_SPEC.md` | implementation contract: accounts, instructions, measurement algorithm, invariants |
| `docs/EDGE_CASES_AND_OPEN_DECISIONS.md` | settled decisions, edge-case policy, the short list of questions worth escalating |
| `docs/BUILD_PROMPTS.md` | the ordered 15-step build sequence; run one step at a time |
| `docs/ENGINEERING_STANDARDS.md` | repo-wide engineering rules |
| `docs/RESEARCH_AND_SOURCE_OF_TRUTH.md` | dated external research and the source hierarchy |
| `docs/ENVIRONMENT_SETUP.md` | local tools, env vars, key separation, Surfpool |
| `docs/CODEX_MCP_AND_SKILLS_SETUP.md` | MCP/doc-resource configuration for agent sessions |
| `docs/TEST_SECURITY_RUNBOOK.md` | test architecture and security review procedure |
| `docs/DEPLOYMENT_RUNBOOK.md` | deployment, protocol initialization, operations |
| `docs/RELEASE_CHECKLIST.md` | hard gate before submission |
| `docs/SPONSOR_AND_SUBMISSION_STRATEGY.md` | Stocklana track/bounty positioning |

Created during the build: `docs/adr/` (architecture decision records), `docs/research/` (dated research
notes, including `current-docs-lock.md` and `current-market.md`), `docs/evidence/` (fork and mainnet
transcripts), `docs/methodology/`, `docs/runbooks/`, `docs/submission/` and, at the very end,
`docs/FINAL_HANDOFF.md`.

## Non-negotiable truths

1. **No Pyth.** The product owner explicitly excluded Pyth from this project. Do not reintroduce it as an oracle, dependency, fallback, or sponsor integration.
2. **Mandate v1 does not certify fair value.** It measures market quality on an exact Meteora pool: executable two-sided depth, effective spread/round-trip friction, provider-contributed in-range liquidity, availability and freshness. It does not claim the market price is fundamentally correct.
3. **Do not pay for aggregate pool quality alone.** A provider must register exact DLMM position accounts. Observer attestations must verify those positions belong to/are controlled by the accepted provider and must separately quantify their attributable contribution.
4. **Use official Meteora SDK/state.** Do not reimplement DLMM bin, quote, fee or position math from memory when the current SDK exposes it.
5. **Observer trust must be explicit.** V1 uses a threshold observer quorum over public onchain state because the Mandate Anchor program cannot efficiently reproduce full Meteora quote/position evaluation onchain. Never market this as fully trustless. Every attestation must be reproducible and auditable.
6. **Chain is the financial source of truth.** Reward escrow, bids, award, epoch settlement, earnings and claims live onchain. PostgreSQL is a reconstructable read model.
7. **The selected provider never receives sponsor reward upfront.** Reward is earned epoch by epoch.
8. **No fake market data.** Production and submission evidence must use a real approved Meteora pool and real onchain positions. Fixtures are only for deterministic tests and must be labelled as such.
9. **No server-side user private keys.** Human sponsors/providers sign through Wallet Standard. Observer signing keys and optional protocol authorities are infrastructure secrets, not user wallets.
10. **Money math is integer safe.** No JS `number` may decide USDC settlement amounts, token amounts, epoch rewards or bps comparisons.
11. **PreStocks bounty isolation.** If entering the PreStocks bounty, do not integrate competing non-PreStocks pre-IPO tokens.
12. **Clawpump is optional and gated.** Do not make the core Mandate depend on Clawpump. If attempting that bounty, first prove the exact required stock pair is supported by the current `/pump-pairs` catalogue and satisfy the current Stocklana requirement literally.
13. **Meteora DBC bounty is not automatically earned.** Core Mandate uses DLMM. Ordinary DLMM usage does not qualify for the DBC bounty. Only add a DBC extension if it is a real product function and current sponsor requirements are met.

## Product scope lock for v1

Build these capabilities:

- approved PreStocks/USDC Meteora DLMM market registry;
- sponsor-created mandate with an escrowed USDC maximum budget;
- open provider bids;
- sponsor acceptance of one provider/bid;
- provider registration of one or more exact DLMM position accounts, capped by protocol limits;
- fixed measurement epochs;
- observer-quorum attestations over canonical measurements;
- binary per-epoch compliance under explicit thresholds;
- deterministic reward accrual only for compliant epochs;
- provider reward claims;
- sponsor withdrawal of surplus/unearned funds only when contract rules permit;
- complete event/indexer/API/web experience;
- real Surfpool/mainnet-fork integration testing;
- deliberately tiny real-mainnet proof before submission if safe.

Do **not** expand v1 into:

- a general LP asset manager;
- custody of provider trading capital;
- a market-making strategy engine;
- price/fair-value oracle service;
- cross-DEX mandates;
- automatic maker selection using opaque AI;
- slashing based on subjective judgements;
- multi-provider split awards;
- insurance;
- a DBC launchpad;
- a protocol token merely to chase a bounty.

## When to stop and ask the product owner

Stop and ask only when a decision changes one of these materially:

- who can seize/withdraw/claim USDC;
- whether an observer can cause money movement beyond recording objectively defined metrics;
- supported PreStocks/market eligibility;
- reward handling for an epoch that cannot be reconstructed/observed;
- whether sponsor cancellation after activation should ever be allowed;
- a proposed Clawpump/DBC extension that changes Mandate economics;
- custody or strategy control over a provider's liquidity;
- legal/compliance representations shown to users.

Do not ask for routine framework, naming, test or refactoring choices a senior engineer should make.

## Definition of a good implementation

A strong implementation is boring where money moves and sophisticated where evidence is measured. It should be possible for an external engineer to:

- inspect a mandate account;
- inspect its exact accepted bid and provider;
- identify the registered Meteora positions;
- reproduce an epoch's metric computation from the recorded slot/account evidence and pinned SDK version;
- verify the observer signatures;
- compute the same pass/fail result;
- reconcile earned/claimed/refunded USDC exactly from chain events and balances.

If that cannot be done, Mandate is not finished.
