# Mandate — Environment and Local Setup

This document describes the intended development/production environment. The implementation agent must update exact commands and versions after Prompt 1 verifies current official docs.

## 1. Required local tools

Install and pin current compatible versions of:

- Git;
- Node.js (supported/pinned project version);
- pnpm;
- Rust toolchain;
- Solana CLI/Agave current compatible version;
- Anchor/AVM current compatible version;
- Docker + Docker Compose;
- PostgreSQL client;
- Redis client if Redis is used;
- Surfpool CLI;
- optional `jq` and standard shell tooling.

Recommended MCP/skills are documented in `docs/CODEX_MCP_AND_SKILLS_SETUP.md`.

Verify:

```bash
node --version
pnpm --version
rustc --version
solana --version
anchor --version
docker --version
surfpool --version
```

Record actual supported versions in repository README/ADR and CI.

---

## 2. External accounts/services

### Required for realistic development

- Solana mainnet RPC provider with WebSocket support;
- PostgreSQL;
- optionally Redis for production-like queue testing;
- funded development wallets only where a real mainnet proof is explicitly intended.

### Required for PreStocks

No API key was required for the public product endpoint during research:

```text
https://prestocks.com/api/prestocks
```

Treat it as an external dependency that can change; runtime validation is mandatory.

### Required for Meteora

No private Meteora API key should be required for core onchain DLMM reads through Solana RPC. Use the official SDK and current program state.

### Optional Clawpump

Only if Prompt 14 is deliberately activated:

- Clawpump account;
- `cpk_...` API key;
- funded agent/payout wallet as required by current docs.

Never put the key in Git, browser environment variables, public logs or prompts.

---

## 3. Suggested local infrastructure

`docker compose` should provide at least:

```text
postgres
redis          # if chosen
prometheus     # optional dev observability
```

Do not containerize Solana/Surfpool merely for consistency if official local tooling works more reliably outside Docker.

Example service roles:

```text
web       -> frontend only
api       -> public typed reads / tx builders
indexer   -> Solana chain ingestion
scheduler -> epoch jobs/finalization/reconciliation
observer1 -> observer key 1
observer2 -> observer key 2
observer3 -> observer key 3
```

For local deterministic tests, observer services may share one codebase but must run with different keys/process identity.

---

## 4. Environment variables

The final implementation may rename these; `docs/FINAL_HANDOFF.md` must reflect actual names. All apps should use a typed env schema and fail startup on missing/invalid required values.

### Shared chain/runtime

```text
SOLANA_CLUSTER=localnet|surfpool|devnet|mainnet-beta
SOLANA_RPC_HTTP_URL=
SOLANA_RPC_WS_URL=
SOLANA_FALLBACK_RPC_HTTP_URL=
SOLANA_COMMITMENT=confirmed
MANDATE_PROGRAM_ID=
USDC_MINT=
```

Never default a production deployment to the public Solana RPC.

### Web

Only public values:

```text
NEXT_PUBLIC_SOLANA_CLUSTER=
NEXT_PUBLIC_SOLANA_RPC_HTTP_URL=   # only if intentionally safe/public; prefer backend/config strategy
NEXT_PUBLIC_MANDATE_PROGRAM_ID=
NEXT_PUBLIC_API_BASE_URL=
```

Do not expose private RPC API keys if provider terms/security do not permit browser use.

### API

```text
PORT=3001
DATABASE_URL=
REDIS_URL=
SOLANA_RPC_HTTP_URL=
SOLANA_RPC_WS_URL=
MANDATE_PROGRAM_ID=
PRESTOCKS_API_URL=https://prestocks.com/api/prestocks
PRESTOCKS_CACHE_TTL_SECONDS=
EVIDENCE_PUBLIC_BASE_URL=
```

API should not need a user signing key.

### Indexer

```text
DATABASE_URL=
SOLANA_RPC_HTTP_URL=
SOLANA_RPC_WS_URL=
MANDATE_PROGRAM_ID=
INDEXER_START_SIGNATURE_OR_SLOT=
INDEXER_CONFIRMATION_LEVEL=confirmed
INDEXER_RECONCILE_INTERVAL_SECONDS=
```

### Scheduler

```text
DATABASE_URL=
REDIS_URL=
SOLANA_RPC_HTTP_URL=
MANDATE_PROGRAM_ID=
SCHEDULER_RELAYER_KEYPAIR_PATH=   # optional low-balance fee payer only
EPOCH_JOB_LEAD_SECONDS=
FINALIZE_RETRY_LIMIT=
```

If finalization remains permissionless, the relayer key should hold only enough SOL for fees and no protocol authority.

### Observer — each instance

```text
OBSERVER_KEYPAIR_PATH=
OBSERVER_EXPECTED_PUBKEY=
OBSERVER_INSTANCE_ID=observer-1
SOLANA_RPC_HTTP_URL=
SOLANA_RPC_WS_URL=
MANDATE_PROGRAM_ID=
DATABASE_URL=                     # optional evidence/index visibility
EVIDENCE_STORAGE_MODE=filesystem|s3-compatible
EVIDENCE_STORAGE_PATH=
EVIDENCE_S3_ENDPOINT=
EVIDENCE_S3_BUCKET=
EVIDENCE_S3_ACCESS_KEY_ID=
EVIDENCE_S3_SECRET_ACCESS_KEY=
MEASUREMENT_ALGORITHM_VERSION=1
```

Use separate RPC/provider configuration for at least some observers in production.

### Observability

```text
LOG_LEVEL=info
OTEL_EXPORTER_OTLP_ENDPOINT=
PROMETHEUS_PORT=
SENTRY_DSN=                      # optional; scrub secrets/wallet-sensitive data
```

### Optional Clawpump

```text
CLAWPUMP_API_KEY=
CLAWPUMP_AGENT_ID=
CLAWPUMP_API_BASE=https://clawpump.tech/api/v1
```

Server/agent only. Never `NEXT_PUBLIC_`.

---

## 5. Keys and wallet separation

Use distinct identities:

### Program deploy authority

Used only for program deployment/upgrade.

### Protocol admin

Used for protocol configuration, market approval and observer-set version creation. Do not use it as a routine hot backend key. Post-hackathon target should be multisig/governance.

### Observer keys

Generate at least three different keypairs for target 2-of-3 operation.

Example current equivalent:

```bash
solana-keygen new --outfile .keys/observer-1.json
solana-keygen new --outfile .keys/observer-2.json
solana-keygen new --outfile .keys/observer-3.json
```

`.keys/` must be gitignored.

### Scheduler relayer

Optional small SOL fee-payer. It owns no protocol/admin rights and no user funds.

### User wallets

Sponsor and provider wallets are external Wallet Standard wallets. Their keys never enter server configuration.

---

## 6. Initial repository setup

After Prompt 1 scaffolding, intended flow:

```bash
git clone <repo>
cd mandate
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/indexer/.env.example apps/indexer/.env
cp apps/scheduler/.env.example apps/scheduler/.env
cp apps/observer/.env.example apps/observer/.env.observer1
```

Start local infrastructure:

```bash
docker compose up -d postgres redis
pnpm db:migrate
```

Run quality gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
anchor build
cargo test --workspace
```

Exact root scripts should be standardized in implementation.

---

## 7. Local Anchor development

For pure program tests:

```bash
anchor build
anchor test
```

Use deterministic local test mints only where the test is explicitly a unit/integration fixture. Do not use them in final product/demo claims.

For realistic market measurement, local synthetic pools are insufficient. Use Surfpool/mainnet state.

---

## 8. Surfpool mainnet-fork environment

Read current official Surfpool docs before running.

Intended workflow conceptually:

```bash
surfpool start --rpc-url "$UPSTREAM_MAINNET_RPC"
```

Then point:

```text
SOLANA_CLUSTER=surfpool
SOLANA_RPC_HTTP_URL=<surfpool local RPC>
```

Verify real state:

```bash
pnpm inspect:prestocks
pnpm market:discover --symbol ANTHROPIC
pnpm market:measure --pool <verified-pool>
```

The fork must load real:

- PreStocks mint account/extensions;
- USDC;
- Meteora DLMM program/pool/bin arrays;
- real existing position state where queried.

When creating new test provider positions on the fork, use real Meteora program instructions against the fork rather than mocked position records.

---

## 9. PreStocks asset discovery

Never hardcode the production allowlist from memory.

Run the repository inspection command that:

1. fetches current API;
2. validates schema;
3. prints exact mint/symbol/mark/token price for context;
4. inspects each target mint on Solana;
5. writes a dated artifact under `docs/research/`.

Example intended command:

```bash
pnpm prestocks:inspect --symbol ANTHROPIC
```

Current research observed ANTHROPIC mint:

```text
Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw
```

Do not assume this line overrides current API/onchain verification.

---

## 10. Meteora market discovery

Build a first-party script using official Meteora SDK/program discovery.

Intended command:

```bash
pnpm meteora:discover --base <PRESTOCK_MINT> --quote <USDC_MINT>
```

For each candidate print:

- pool pubkey;
- DLMM program identity;
- X/Y mint orientation;
- bin step/fee info;
- active bin;
- current quote probe;
- current positions/liquidity summary;
- network/slot.

Admin approval should use the exact verified pool key, not a symbol.

---

## 11. Running observer instances locally

Each observer needs a separate env/key.

Conceptual:

```bash
pnpm --filter @mandate/observer start --env-file .env.observer1
pnpm --filter @mandate/observer start --env-file .env.observer2
pnpm --filter @mandate/observer start --env-file .env.observer3
```

If the runtime does not support `--env-file`, use separate process managers/container env.

Observer logs must contain:

- observer pubkey;
- mandate;
- epoch;
- algorithm version;
- observed slot;
- payload hash;
- evidence hash;
- tx signature;

Never log private keys or raw environment.

---

## 12. Database migration discipline

Use forward migrations.

Production:

```bash
pnpm db:migrate:deploy
```

Local reset only:

```bash
pnpm db:reset
```

Never auto-reset production on startup.

Every table that mirrors chain state must include provenance (`slot`, `signature`, `updated_at`, chain address).

---

## 13. Evidence storage

For reproducibility, observer evidence should be durable.

Local:

```text
./data/evidence/<mandate>/<epoch>/<observer>.json.gz
```

Production: S3-compatible/object storage recommended.

Security:

- evidence contains only public chain state and algorithm metadata;
- do not put secret env values in evidence;
- hash canonical payload/evidence;
- bucket writes authenticated; public read can be separate if desired;
- DB stores evidence URI + SHA-256.

The chain hash is the integrity anchor; object storage is not allowed to redefine epoch metrics.

---

## 14. Optional Clawpump setup

Do not configure until Prompt 14 is approved.

Read current docs, then create API key through current dashboard.

Use server/agent environment only:

```bash
export CLAWPUMP_API_KEY='cpk_...'
```

Discovery must happen before any launch:

```bash
curl -H "Authorization: Bearer $CLAWPUMP_API_KEY" \
  https://clawpump.tech/api/v1/pump-pairs
```

Do not launch/spend just to test connectivity. Use documented preflight/cost discovery first.

---

## 15. Production environment separation

At minimum:

```text
development
staging/mainnet-fork
production-mainnet
```

Separate:

- databases;
- Redis namespaces/clusters;
- observer keys;
- RPC credentials;
- evidence buckets;
- admin/deploy keys;
- telemetry projects.

A production service must refuse to start if:

- cluster and program ID mismatch expected allowlist;
- observer key pubkey != configured expected pubkey;
- production uses a known local/fork program ID;
- critical secrets are placeholder values.

---

## 16. Clean-machine verification

Before final handoff, a second engineer should be able to:

```bash
git clone ...
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
anchor build
pnpm test
pnpm dev
```

Then follow a documented Surfpool flow without undocumented manual DB edits.

If a step requires a secret/funded wallet, documentation must explain exactly why and how to provide it safely.
