# Mandate — Engineering Standards

These standards apply to the whole Mandate repository. `docs/PRD.md`, `docs/TECHNICAL_SPEC.md` and `AGENTS.md` override them only where they are more restrictive.

## 1. Production mindset

This is live financial software. Treat every money-moving path as security-sensitive.

Required behaviors:

- default-deny authorization;
- explicit state machines;
- checked arithmetic;
- deterministic settlement;
- idempotent offchain jobs;
- replayable indexers;
- auditable external-data provenance;
- fail-closed behavior for unsupported assets and malformed external data;
- clear distinction between confirmed, finalized, pending, failed, stale and unavailable state.

Do not optimize for hackathon screenshots at the expense of correctness.

---

## 2. Monorepo baseline

Recommended package manager: **pnpm** with a pinned version via `packageManager` in root `package.json`.

Workspace structure. `docs/TECHNICAL_SPEC.md` §3 is authoritative; this is the same tree
restated, so any divergence between the two is a bug in this file.

```text
apps/
  web/                # Next.js frontend, Wallet Standard
  api/                # stateless public read API + unsigned tx building
  indexer/            # chain event/account indexer + backfill
  observer/           # deterministic Meteora measurement worker
  scheduler/          # epoch scheduling/quorum/finalize jobs
programs/
  mandate/            # Anchor program
packages/
  domain/             # canonical types, reward/epoch math, status logic
  solana/             # generated clients, PDA builders, tx helpers
  meteora/            # DLMM venue adapter + measurement algorithm
  prestocks/          # typed public API adapter
  db/                 # schema and migrations
  config/             # validated env/runtime config
  observability/      # logging/metrics/tracing helpers
  testkit/            # deterministic fixtures, tests only
  ui/                 # optional shared components
  clawpump/           # optional, gated; see AGENTS.md
infra/
scripts/
docs/
  adr/
  research/
  runbooks/
  methodology/
  evidence/
tests/
```

Root tooling should include:

- TypeScript strict mode;
- ESLint/current equivalent;
- Prettier/current formatter or an agreed formatter;
- Rust formatting + Clippy;
- Anchor/Solana tests;
- Vitest/current unit test runner;
- Playwright for critical browser flows;
- CI that runs typecheck, lint, unit, Rust, program and build tests.

Do not put the Anchor workspace inside a structure that makes reproducible program builds unnecessarily fragile. Verify current Anchor workspace recommendations before finalizing the tree.

---

## 3. Language/runtime rules

### TypeScript

Use:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Where compatible with framework tooling.

Rules:

- no `any` in domain/settlement code without a documented reason;
- parse external JSON through runtime schemas (for example Zod/current equivalent);
- exact raw token amounts are `bigint` or decimal strings across JSON boundaries;
- centralize token decimal conversion;
- never serialize a `bigint` implicitly;
- never compare monetary amounts after converting to JS `number`.

### Rust / Anchor

Rules:

- checked integer arithmetic for all financial operations;
- explicit upper/lower bounds on user-provided durations, bps and amounts;
- no unchecked casts where overflow/truncation can affect money;
- use account constraints as part of the security model, not merely handler checks;
- no dynamic/unbounded vectors in frequently touched financial accounts;
- close accounts only when the economic lifecycle allows it;
- define stable error codes for UI/indexer interpretation;
- emit meaningful events for replay/indexing.

---

## 4. Onchain state-machine discipline

Every financial object must have a documented state graph.

Rules:

- each instruction declares which prior states it accepts;
- each instruction declares the exact next state;
- impossible transitions are rejected onchain;
- timestamps use Solana Clock sysvar/current secure clock source, not client time;
- offchain UI never gets authority to decide that a financial deadline has passed;
- repeated instructions must either be safely idempotent or fail with a stable, expected error.

For every state transition, write tests for:

- valid boundary;
- one unit before/after time boundary;
- duplicate submission;
- wrong signer;
- wrong mint/account;
- wrong token program;
- insufficient funds;
- overflow/maximum values;
- paused protocol behavior;
- account substitution attacks.

---

## 5. Admin and authority design

Do not use one hot wallet for every power.

Separate at least conceptually:

- upgrade authority;
- protocol-config authority;
- asset/market registry authority;
- observer authority (Mandate only);
- deployment payer;
- operational indexer/API keys.

Before mainnet:

- move upgrade/admin authorities to an appropriately secured multisig or document why not;
- keep operational backend keys unable to seize user funds;
- ensure admin pause semantics preserve user exits wherever possible;
- document every admin capability in the UI/docs.

No hidden “rescue funds” backdoor unless explicitly designed, narrowly scoped and disclosed. Prefer programmatic self-service exits.

---

## 6. Token handling

Build a shared internal `TokenDescriptor` abstraction with at least:

```text
mint
programId
decimals
symbol
name
extensions[]
verifiedSource
verifiedAt
```

Before any supported token moves:

1. fetch mint account;
2. confirm token program;
3. parse decimals;
4. parse relevant Token-2022 extensions;
5. confirm mint equals the configured allowlist entry;
6. derive/create only correct associated/token accounts;
7. use checked token instructions/current Anchor interface.

Do not infer a mint from symbol at transaction time.

---

## 7. External API reliability

Every adapter must implement:

- typed response validation;
- explicit timeout;
- bounded retry with jitter for safe/idempotent reads;
- no blind retries for non-idempotent writes;
- circuit breaker or degraded-state handling when appropriate;
- request correlation IDs;
- structured logs excluding secrets;
- source timestamp/freshness.

External API failure must not change onchain rights silently.

Example: the PreStocks API being unavailable must **not** stop an accepted provider from claiming reward already earned on an active mandate, and must not stop epoch attestation or finalization, because those contractual terms and metrics live onchain and in Meteora state.

---

## 8. Database and indexing

Recommended: PostgreSQL + Prisma/current stable ORM if Prisma remains appropriate after version check.

Database is a **projection**, not settlement authority.

Requirements:

- unique constraints for chain identity (`signature + instruction/event index` or exact equivalent);
- cursor/checkpoint table;
- WebSocket/live path + deterministic backfill path;
- reorg/commitment strategy documented;
- rebuild command from a chosen slot/signature range;
- migrations checked into source control;
- no schema changes applied manually in production without migration artifact.

Redis/BullMQ or current equivalents can be used for queues. Jobs must be idempotent with stable deduplication keys.

---

## 9. API design

Recommended backend: NestJS if the team is productive with it.

Separate:

- read/query endpoints;
- transaction-build endpoints;
- signed-transaction submission only if truly necessary;
- admin endpoints.

Prefer the user's wallet to submit signed transactions directly through a configured RPC when practical. Backend transaction builders must never accept arbitrary destination accounts from untrusted client input when those destinations are supposed to come from protocol state.

All APIs must:

- validate input;
- rate limit abusive unauthenticated routes;
- use explicit versioning or stable contracts;
- return machine-readable error codes;
- expose `asOf` timestamps for indexed/external data;
- avoid leaking stack traces/secrets.

---

## 10. Frontend financial UX

Never collapse these into one status:

```text
DRAFT
AWAITING_SIGNATURE
SUBMITTED
CONFIRMED
FINALIZED
FAILED
EXPIRED
STALE_DATA
UNAVAILABLE
```

The user must see before signing:

- exact asset/mint identity in human form;
- raw economic action;
- fees;
- deadlines;
- counterparty rights;
- irreversible consequences;
- whether displayed contextual market data is stale.

Wallet disconnect/reload must not lose onchain state. Recover from chain/indexer.

No optimistic UI that labels a financial action “complete” before chain confirmation.

---

## 11. Observability

Production services should expose:

- structured logs;
- health/readiness endpoints;
- RPC/API latency and error metrics;
- queue depth/failure metrics;
- indexer lag;
- external API freshness;
- transaction simulation/submission/confirmation metrics;
- observer lag and unobserved epochs for Mandate.

Recommended error monitoring: Sentry/current equivalent, with PII/secret scrubbing.

Set alerts for:

- indexer falling behind;
- repeated transaction simulation failures;
- RPC WebSocket disconnect loops;
- external schema validation failure;
- observer downtime (Mandate);
- balance invariant mismatch.

---

## 12. Security testing minimum

Before mainnet:

- unit tests;
- property/fuzz tests for financial math/state transitions;
- Anchor integration tests;
- account-substitution/adversarial tests;
- Token-2022 extension tests;
- mainnet-fork E2E;
- browser E2E;
- dependency/security scan;
- static secret scan;
- manual threat-model review;
- transaction simulation on representative real accounts.

For program fuzzing, use current Anchor/Solana-recommended tooling after reading current docs. Do not introduce a fuzzer solely to tick a box if it cannot exercise meaningful invariants.

---

## 13. Definition of “real” for this hackathon

Allowed:

- deterministic unit fixtures clearly labeled as test fixtures;
- local test token/program state for isolated program tests;
- Surfpool mainnet forks using real external program/account state;
- tiny mainnet transactions for final proof.

Not allowed in production/demo claims:

- fake balances;
- hard-coded fake API responses;
- mock “successful transaction” objects;
- invented transaction signatures;
- screenshots of a local simulation presented as mainnet;
- a button that only updates React state but is described as an onchain action;
- a “market maker agent” that only logs what it would do while the product claims it acted.

When a feature is not live, label it honestly as unavailable or future work.

