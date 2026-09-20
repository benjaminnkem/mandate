# Mandate

**Pay for verified market quality, not deposited TVL.**

Mandate is a Solana-native market-quality procurement protocol. A sponsor escrows USDC and publishes a
measurable liquidity mandate for one approved [Meteora DLMM](https://docs.meteora.ag/) market. Market makers
bid for the contract. The sponsor accepts one bid. The selected provider registers the exact DLMM position
accounts that will satisfy the mandate. An auditable observer quorum measures the pool's executable two-sided
quality and the provider's attributable in-range liquidity at fixed epochs. The provider earns only for the
epochs that satisfy the mandate.

For v1 the supported asset family is **PreStocks paired with USDC** on an approved Meteora DLMM pool.

> An issuer says, "keep this stock market this liquid for six hours." Market makers bid for the job. We measure
> their actual Meteora positions every few minutes and pay only for the periods where the promised spread and
> depth are really there.

## What Mandate is not

- not a liquidity dashboard, and not generic liquidity mining;
- not a fair-value or price oracle — it measures execution quality, not whether a price is economically correct;
- not fully trustless in v1 — measurement is an auditable threshold observer quorum over public onchain state;
- not a custodian of provider trading capital, and not a market-making strategy engine.

There is no Pyth dependency anywhere in this project, by product-owner decision.

## Start here

Read [`AGENTS.md`](AGENTS.md) first. It is the operating contract for every engineer and coding agent working
on this repository, and it links the rest of the documentation in reading order.

| Document | Role |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | non-negotiable rules, scope lock, escalation boundary |
| [`docs/PRD.md`](docs/PRD.md) | product requirements and acceptance criteria |
| [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md) | accounts, instructions, measurement algorithm, invariants |
| [`docs/EDGE_CASES_AND_OPEN_DECISIONS.md`](docs/EDGE_CASES_AND_OPEN_DECISIONS.md) | settled decisions and edge-case policy |
| [`docs/BUILD_PROMPTS.md`](docs/BUILD_PROMPTS.md) | ordered 15-step build sequence |
| [`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md) | local tools, env vars, key separation, Surfpool |
| [`docs/DEPLOYMENT_RUNBOOK.md`](docs/DEPLOYMENT_RUNBOOK.md) | deployment and operations |
| [`docs/TEST_SECURITY_RUNBOOK.md`](docs/TEST_SECURITY_RUNBOOK.md) | test architecture and security review |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) | hard gate before submission |

## Architecture in one paragraph

The Anchor program `mandate` is authoritative for all money movement: reward escrow, bids, accepted terms, the
registered position set, epoch status, exact reward accrual, claims and refunds. Full Meteora measurement
cannot run onchain, so it happens offchain in `packages/meteora` under a versioned, deterministic, open-source
algorithm. Each observer independently computes the same canonical payload from public Solana/Meteora state and
submits a signed attestation. Once the mandate's snapshotted observer quorum agrees exactly, anyone can
finalize the epoch; the program itself compares the attested integer metrics against the mandate's immutable
thresholds and accrues the exact epoch reward. Chain is the financial source of truth; PostgreSQL is a
read model that must be rebuildable from chain and evidence alone.

Epochs resolve to `Compliant`, `NonCompliant`, or `Unavailable` — and `Unavailable` is never silently treated
as provider failure.

## Repository status

Prompts 1 to 3 of [`docs/BUILD_PROMPTS.md`](docs/BUILD_PROMPTS.md) are complete: the monorepo is scaffolded, the
domain and settlement math exist in TypeScript and Rust with shared golden vectors, and a deterministic measurement
engine reproduces real PreStocks/USDC Meteora DLMM measurements byte for byte from a recorded mainnet snapshot (see
[`docs/research/current-market.md`](docs/research/current-market.md) and
[`docs/methodology/measurement-v1.md`](docs/methodology/measurement-v1.md)). No program instruction exists yet, and
no market is approved.

| Area | State |
| --- | --- |
| `apps/web` (Next.js), `apps/api` (Fastify health/meta), `apps/indexer`, `apps/scheduler`, `apps/observer` | runnable shells with validated env |
| `packages/config`, `packages/observability`, `packages/prestocks` | implemented and tested |
| `packages/meteora` | canonical measurement engine v1, atomic snapshot record/replay, canonical evidence (Prompt 3) |
| `packages/domain`, `crates/mandate-core` | integer money math, epoch/reward/compliance/accounting, validation (Prompt 2) |
| `packages/solana`, `packages/db`, `packages/testkit` | empty shells |
| `programs/mandate`, `crates/mandate-core` | builds (`anchor build`); no instructions yet |
| Architecture decisions | [`docs/adr/`](docs/adr/) |

## Toolchain

Pinned and verified (details and sources in [`docs/adr/0002-runtime-and-tool-versions.md`](docs/adr/0002-runtime-and-tool-versions.md)):
Node >= 24, pnpm 11.25.0, TypeScript 6.0.3, Rust 1.89.0, Solana CLI 4.2.2, Anchor 1.2.0, Surfpool 1.6.0,
`@meteora-ag/dlmm` 1.9.14. See [`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md) for PostgreSQL/Redis.

## Commands

```bash
pnpm install
pnpm check              # format, lint, typecheck, tests, rustfmt, clippy, cargo tests
pnpm program:build      # anchor build
pnpm inspect:prestocks -- --symbol OPENAI
pnpm market:discover -- --symbol OPENAI
pnpm market:measure --pool <pool> --base-mint <mint> --provider <wallet> --positions <p1,p2>
```

The two `scripts` commands are read-only and need `SOLANA_RPC_HTTP_URL`. Program, observer, indexer and
end-to-end commands are added as their build steps land.

## Network provenance

Every artifact, screenshot, transcript and demo must state its network: local validator, Surfpool mainnet fork,
devnet, or mainnet-beta. A fork signature is never presented as mainnet.
