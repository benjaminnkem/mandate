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

The build has not started. The repository currently holds the documentation set plus the Turborepo starter's
shared config packages (`packages/eslint-config`, `packages/typescript-config`, `packages/ui`). No Anchor
workspace, program, app or domain package exists yet.

The next step is Prompt 1 in [`docs/BUILD_PROMPTS.md`](docs/BUILD_PROMPTS.md): verify current external docs,
research and verify a real PreStocks/USDC Meteora DLMM pool, write the founding ADRs, and scaffold the
monorepo described in [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md) §3.

## Toolchain

Required and present:

- Node.js >= 24 (`.nvmrc` pending) and pnpm 11.25.0 via `packageManager`.

Required and **not yet installed** on a fresh checkout — see [`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md) §1:

- Rust / Cargo
- Solana CLI
- Anchor (via `avm`)
- Surfpool, for mainnet-fork integration testing
- PostgreSQL, and Redis or the chosen queue

Exact pinned versions are recorded during Prompt 1 in `docs/adr/` and `docs/research/current-docs-lock.md`.

## Commands

```bash
pnpm install
pnpm check-types
pnpm lint
pnpm build
```

Program, observer, indexer and end-to-end commands are added as their build steps land, and are documented in
the runbooks rather than here.

## Network provenance

Every artifact, screenshot, transcript and demo must state its network: local validator, Surfpool mainnet fork,
devnet, or mainnet-beta. A fork signature is never presented as mainnet.
