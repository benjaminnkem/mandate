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

| Document                                                                         | Role                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                                                         | non-negotiable rules, scope lock, escalation boundary     |
| [`docs/PRD.md`](docs/PRD.md)                                                     | product requirements and acceptance criteria              |
| [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md)                               | accounts, instructions, measurement algorithm, invariants |
| [`docs/EDGE_CASES_AND_OPEN_DECISIONS.md`](docs/EDGE_CASES_AND_OPEN_DECISIONS.md) | settled decisions and edge-case policy                    |
| [`docs/BUILD_PROMPTS.md`](docs/BUILD_PROMPTS.md)                                 | ordered 15-step build sequence                            |
| [`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md)                         | local tools, env vars, key separation, Surfpool           |
| [`docs/DEPLOYMENT_RUNBOOK.md`](docs/DEPLOYMENT_RUNBOOK.md)                       | deployment and operations                                 |
| [`docs/TEST_SECURITY_RUNBOOK.md`](docs/TEST_SECURITY_RUNBOOK.md)                 | test architecture and security review                     |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)                         | hard gate before submission                               |

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

Prompts 1 to 12 of [`docs/BUILD_PROMPTS.md`](docs/BUILD_PROMPTS.md) are complete: the monorepo is scaffolded, the
domain and settlement math exist in TypeScript and Rust with shared golden vectors, and a deterministic measurement
engine reproduces real PreStocks/USDC Meteora DLMM measurements byte for byte from a recorded mainnet snapshot (see
[`docs/research/current-market.md`](docs/research/current-market.md) and
[`docs/methodology/measurement-v1.md`](docs/methodology/measurement-v1.md)). The Anchor program has its protocol
foundation (configuration, two-step admin transfer, new-risk pause, immutable observer sets, approved-market registry)
sponsor mandates with atomic USDC escrow in a program-owned vault, open provider bidding, sponsor award with the exact
per-epoch reward split, surplus withdrawal, the provider's locked position set and permissionless activation. Epoch
attestation (`submit_attestation`, stored per observer per epoch, accruing nothing) exists, driven by the leader/replay observer (ADR 0015). Quorum finalization, unavailable recovery, provider claims, sponsor exits, vault closing and a reconciliation CLI exist (ADRs 0016-0017). The read plane exists (ADR 0018): PostgreSQL schema and migrations, an account-authoritative indexer with durable cursor and rebuild, an idempotent job queue and scheduler, a typed read API with unsigned transaction builders, Prometheus metrics and alert rules, and synthetic load tests. The web application exists (ADR 0019): a direct Wallet Standard integration (no
legacy adapter registry, no private key ever touches it), every required surface (landing, approved markets,
explore mandates, create-mandate wizard, mandate detail, provider workspace, methodology, evidence inspector),
one shared financial-write flow that never claims success before the chain confirms, and a Playwright suite
covering all of it plus accessibility and mobile checks. No market is approved yet.

| Area                                                              | State                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                                                        | Next.js app: every required surface, Wallet Standard write flows, unit + Playwright e2e tests (Prompt 12)                                                                                                                                                                                 |
| `apps/api`, `apps/indexer`, `apps/scheduler`                      | read API and tx builders, chain indexer, job scheduler (Prompt 11)                                                                                                                                                                                                                        |
| `packages/config`, `packages/observability`, `packages/prestocks` | implemented and tested                                                                                                                                                                                                                                                                    |
| `packages/meteora`                                                | canonical measurement engine v1, atomic snapshot record/replay, canonical evidence (Prompt 3)                                                                                                                                                                                             |
| `packages/domain`, `crates/mandate-core`                          | integer money math, epoch/reward/compliance/accounting, validation (Prompt 2)                                                                                                                                                                                                             |
| `packages/solana`                                                 | IDL-driven TypeScript client, verified byte-for-byte against the Rust program (Prompt 5)                                                                                                                                                                                                  |
| `apps/observer`                                                   | leader/replay observer CLI: one key, deterministic epoch job, durable evidence, idempotent attestation (Prompt 8)                                                                                                                                                                         |
| `packages/db`, `packages/testkit`                                 | Postgres schema, migrations, queue and read model (Prompt 11); labelled synthetic fixtures for tests                                                                                                                                                                                      |
| `programs/mandate`                                                | 23 instructions: protocol config, admin transfer, pause, observer sets, market registry, mandate + escrow, bidding, award, surplus withdrawal, position set, activation, unactivated refund, epoch attestation, quorum finalization, unavailable recovery, claims, closing (Prompts 4-10) |
| `crates/mandate-core`                                             | pure settlement + protocol validation + fail-closed `LbPair` reader                                                                                                                                                                                                                       |
| `crates/program-tests`                                            | 199 LiteSVM tests executing the compiled SBF binary, plus Rust-generated client vectors                                                                                                                                                                                                   |
| Architecture decisions                                            | [`docs/adr/`](docs/adr/)                                                                                                                                                                                                                                                                  |

## Toolchain

Pinned and verified (details and sources in [`docs/adr/0002-runtime-and-tool-versions.md`](docs/adr/0002-runtime-and-tool-versions.md)):
Node >= 24, pnpm 11.25.0, TypeScript 6.0.3, Rust 1.98.1 (host), Solana CLI 4.2.2, Anchor 1.2.0, Surfpool 1.6.0, LiteSVM 0.16,
`@meteora-ag/dlmm` 1.9.14. See [`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md) for PostgreSQL/Redis.

## Clean clone setup

```bash
git clone <this-repository-url> mandate
cd mandate
pnpm install
```

Install the pinned toolchain from the table below first (Node, pnpm, Rust, Solana CLI, Anchor). Then copy every
app's env template and fill in real values (local defaults are enough for `pnpm check`; see
[`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md) for PostgreSQL/Redis and key setup):

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/indexer/.env.example apps/indexer/.env
cp apps/scheduler/.env.example apps/scheduler/.env
cp apps/observer/.env.example apps/observer/.env
```

## Commands

```bash
pnpm check              # format, vectors, lint, typecheck, TS tests, rustfmt, clippy, program build, Rust tests
pnpm program:build      # cargo build-sbf + anchor idl build
pnpm inspect:prestocks -- --symbol OPENAI
pnpm market:discover -- --symbol OPENAI
pnpm market:measure --pool <pool> --base-mint <mint> --provider <wallet> --positions <p1,p2>
pnpm positions:inspect --pool <pool> --base-mint <mint> --provider <wallet> --positions <p1,p2>   # before registering
pnpm db:migrate          # DATABASE_URL required
pnpm indexer:rebuild     # destructive to derived tables only
pnpm test:load           # SYNTHETIC load tests (reads and scheduling)
pnpm reconcile:mandate <mandate-address>   # read-only ledger vs vault check; exits 1 on any mismatch
pnpm test:e2e             # Playwright: web app UI/wallet flows against a real browser, mocked network
```

The two `scripts` commands are read-only and need `SOLANA_RPC_HTTP_URL`.

## Running the apps locally

Each app is started from its own directory once its `.env` is filled in and, for `apps/api`/`apps/indexer`/
`apps/scheduler`, once `pnpm db:migrate` has run against a local PostgreSQL (see
[`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md)):

```bash
pnpm --filter @mandate/api dev         # read API + unsigned tx builders
pnpm --filter @mandate/indexer dev     # chain indexer
pnpm --filter @mandate/scheduler dev   # epoch/job scheduler
pnpm --filter @mandate/web dev         # Next.js app, http://localhost:3000
```

`apps/observer` is run as a one-shot CLI job, not a long-lived server — see its own README/`docs/ENVIRONMENT_SETUP.md`
for the exact epoch-measurement invocation.

## Network provenance

Every artifact, screenshot, transcript and demo must state its network: local validator, Surfpool mainnet fork,
devnet, or mainnet-beta. A fork signature is never presented as mainnet.
