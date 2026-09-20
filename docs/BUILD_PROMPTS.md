# Mandate — Ordered Codex Build Prompts

Use these prompts **one at a time, in order**. Keep the same repository/session context where possible. Do not paste the entire sequence into Codex at once.

Every prompt assumes all previous steps are committed, tested and passing. Codex must stop after each stage and report exactly what changed.

If Codex discovers uncertainty about custody, reward rights, observer trust, supported market semantics, or a sponsor requirement, it must ask before inventing behavior. Routine engineering decisions should be made by Codex as a senior engineer and documented in an ADR.

---

## Prompt 1 — current-doc verification, live-market research and production scaffold

```text
You are the principal engineer for Mandate, a live Solana market-quality procurement protocol. Treat this as financial infrastructure, not a hackathon toy.

Read these files completely before doing anything:
- AGENTS.md
- docs/PRD.md
- docs/TECHNICAL_SPEC.md
- docs/EDGE_CASES_AND_OPEN_DECISIONS.md
- docs/RESEARCH_AND_SOURCE_OF_TRUTH.md
- docs/ENGINEERING_STANDARDS.md
- docs/CODEX_MCP_AND_SKILLS_SETUP.md

Use the configured Solana and Meteora documentation MCP/resources and current official docs to verify:
- current recommended Solana client + Wallet Standard stack;
- current Anchor/toolchain version and program/client workflow;
- current Meteora DLMM SDK package, account model, quote methods, position methods and Token-2022 handling;
- current Surfpool mainnet-fork workflow;
- current PreStocks public API schema;
- current Stocklana sponsor requirements for PreStocks, Meteora and Clawpump.

Research a REAL current PreStocks/USDC Meteora DLMM pool. Do not trust a third-party pair address blindly: discover/verify it from current Solana/Meteora state using official SDK/program data. Record the exact pool, mints, orientation, program IDs, token extensions, SDK version and reproducible commands in docs/research/current-market.md.

Also check current Clawpump docs and GET /pump-pairs only if credentials are available. Do not make Clawpump a dependency and do not spend funds.

This step is ONLY:
1. write ADRs for monorepo architecture, runtime/tool versions, DB, queues, observer topology and network strategy;
2. scaffold the monorepo from docs/TECHNICAL_SPEC.md;
3. configure strict TypeScript/Rust lint/typecheck/test/build tooling;
4. configure validated environment loading and .env.example files with placeholders only;
5. scaffold apps/web, apps/api, apps/indexer, apps/observer, apps/scheduler and packages/domain/solana/meteora/prestocks/db/config/observability;
6. configure Anchor workspace/program shell;
7. add CI that passes on scaffold;
8. add docs/research/current-docs-lock.md with every source/version checked and unresolved material issue;
9. do not implement settlement instructions or measurement math yet.

Rules:
- no fake production market data;
- no copied competitor code;
- no deprecated package just because an old tutorial is easier;
- pin dependencies/lockfiles;
- no Pyth;
- never put private keys in repo or prompt output;
- if current Meteora APIs differ materially from TECHNICAL_SPEC, document and explain before changing product semantics.

Run all scaffold checks. End with exact versions, verified live market evidence, commands that pass and any material question. STOP.
```

---

## Prompt 2 — canonical domain, reward math and epoch semantics

```text
Continue from the passing scaffold. Re-read docs/PRD.md and docs/TECHNICAL_SPEC.md.

Implement packages/domain and pure Rust equivalents BEFORE program instructions.

Deliver:
1. canonical enums/types for ProtocolConfig, ObserverSet, MarketConfig, MandateStatus, Mandate, BidStatus, Bid, PositionSet, EpochStatus, EpochMetrics, Attestation and EpochResult;
2. bigint-only raw amount/bps utilities;
3. exact mandate timing/epoch-index functions using integer timestamps;
4. exact accepted-reward split into base epoch reward + final remainder;
5. exact claimable/sponsor-withdrawable accounting functions;
6. pure compliance predicate matching TECHNICAL_SPEC;
7. validation schemas for mandate thresholds/timing/bids;
8. golden test vectors for boundaries, max values, remainder, one-raw-unit and overflow-adjacent values;
9. corresponding pure Rust modules/tests;
10. cross-language verification that TS and Rust produce identical output for golden vectors.

No settlement-critical JavaScript number/floating point.
Do not implement the Meteora measurement algorithm yet.
Do not implement Anchor instructions yet.

Run tests, summarize proven invariants and STOP.
```

---

## Prompt 3 — deterministic Meteora DLMM measurement engine

```text
Implement the canonical measurement engine in packages/meteora using the VERIFIED current official Meteora DLMM SDK.

First re-read the official SDK reference/examples and the exact live pool evidence from Prompt 1.

Implement a typed DLMM adapter that:
- loads the exact pool and base/quote orientation;
- reads active bin and necessary bin arrays;
- loads exact registered position accounts;
- verifies pool relationship and ownership/operator semantics for supported position types;
- produces buy/sell quotes using official SDK math;
- rejects partial fills where the spec requires full consumption;
- never silently falls back to third-party price APIs.

Implement algorithm version 1 exactly from TECHNICAL_SPEC:
- baseline probe Q0 -> B0 -> S0;
- exact effective spread formula;
- deterministic buy-depth exponential + binary search;
- deterministic sell-depth search;
- provider quote/base amounts in configured in-band bins;
- exact base-to-quote-equivalent normalization;
- canonical evidence payload serialization + SHA-256 hashes;
- algorithm version/source/lockfile provenance.

Important:
- use BigInt/BN/Decimal only where required by the SDK; convert final settlement metrics to exact integers;
- no JS number for USDC/token amounts or bps settlement comparisons;
- if the SDK exposes floating priceImpact, do not use it as the authoritative pass/fail variable; use the exact cross-multiplied comparisons in the spec;
- normalize token X/Y orientation explicitly.

Tests:
- deterministic synthetic unit cases labelled TEST FIXTURE;
- captured real/fork account snapshots for golden regression tests;
- reversed X/Y orientation;
- low-liquidity and partial-fill cases;
- zero/closed position;
- duplicate positions;
- multiple registered positions;
- boundary exactly equal to band;
- one raw unit over/under;
- repeat 100+ times and prove payload hash stability.

Also create a CLI command that measures the current verified live pool READ-ONLY and prints a provenance-rich report.

Do not move money or build the Anchor program yet.
STOP after tests and a real read-only measurement report.
```

---

## Prompt 4 — Anchor protocol config, observer sets and approved market registry

```text
Implement foundational Mandate Anchor state/instructions only.

Implement:
- ProtocolConfig PDA;
- safe two-step admin transfer if appropriate;
- immutable versioned ObserverSet PDA;
- MarketConfig PDA for MeteoraDlmm only;
- initialize_protocol;
- create_observer_set;
- upsert/enable/disable market config;
- new-risk pause semantics;
- events/errors.

Requirements:
- exact configured USDC mint/token program;
- market binds exact DLMM pool, base/quote mints, decimals and PreStocks metadata hash;
- observer pubkeys unique and threshold bounded;
- active mandates in future steps will snapshot an immutable observer set;
- admin receives no reward-vault seizure power;
- no unbounded vectors.

Where practical, validate mint/token-program/decimals onchain. Do not invent Meteora account parsing if official IDL/types are not safely available; if market semantic verification remains an offchain onboarding control, document that trust boundary explicitly.

Test signer/account-substitution/bounds/pause/admin-transfer/observer-set immutability thoroughly.
Do not implement mandates/bids yet.
STOP.
```

---

## Prompt 5 — mandate creation and USDC reward escrow

```text
Implement create_mandate and cancel_unawarded_mandate.

Requirements:
- sponsor signer;
- exact MarketConfig + snapshotted ObserverSet;
- validate bidding/start/end/epoch arithmetic and total epoch bounds;
- validate probe, spread, depth-band and minimum-depth/contribution thresholds;
- transfer exact max_reward_raw USDC to a program-controlled reward vault in the same successful transaction;
- initialize all accounting fields deterministically;
- duplicate mandate ID prevention;
- cancellation only before award under spec rules;
- cancellation returns the exact vault amount to sponsor;
- pause blocks new mandate creation but not valid cancellation/refund.

USDC mint/program comes from ProtocolConfig, never arbitrary client input.

Test:
- successful escrow;
- insufficient balance;
- wrong USDC mint/program/account owner;
- invalid market/observer set;
- every time/bounds edge;
- overflow;
- duplicate PDA;
- cancel by stranger;
- pause;
- vault invariants.

STOP after program + client tests pass.
```

---

## Prompt 6 — open bidding, award and exact reward reservation

```text
Implement provider bidding and sponsor award.

Instructions:
- submit_bid;
- cancel_bid;
- accept_bid;
- withdraw_surplus_after_award.

Rules:
- Active bid only while mandate Bidding and before bidding close;
- requested reward > 0 and <= mandate max reward;
- bid valid_until rules;
- nonce allows same provider to create distinct bids without overwriting history;
- sponsor alone accepts;
- accepted provider/bid/reward become immutable;
- calculate base_epoch_reward + final remainder onchain using canonical math;
- no accepted provider reward is transferred upfront;
- max-minus-accepted surplus can be withdrawn by sponsor without touching reserved accepted reward;
- unselected bid accounts can be cancelled/closed by their providers.

Do not implement positions/epochs yet.

Test races: two bids accepted sequentially, expired bid, cancellation vs acceptance ordering, one raw unit bounds, sponsor account substitution, vault amount after surplus withdrawal.
STOP.
```

---

## Prompt 7 — provider position set and activation

```text
Implement the v1 fixed provider PositionSet and mandate activation.

Instructions:
- register_positions / update pre-lock;
- lock position set if separate instruction is useful;
- activate_mandate permissionlessly at/after start.

Rules:
- accepted provider only;
- max positions bounded and unique/non-default;
- exact accepted provider + mandate binding;
- PositionSet mutable only before immutable lock cutoff;
- after lock/start, no position-key replacement for v1;
- activation does not require sponsor cooperation;
- Mandate cannot activate without accepted bid + locked PositionSet;
- no claim that the Anchor program verified Meteora ownership; observer measurement does that.

Create client-side tooling to inspect each registered position with the official Meteora adapter before the user signs registration, and clearly warn/reject unsupported position types.

Test all unauthorized/duplicate/late registration/state transitions.
STOP.
```

---

## Prompt 8 — observer service, canonical evidence and signed onchain attestations

```text
Build apps/observer and implement submit_attestation in the Anchor program.

Observer requirements:
- one process configured with exactly one observer key;
- deterministic job input: mandate + epoch;
- read mandate/market/position set from chain;
- invoke the exact packages/meteora algorithm;
- produce canonical evidence + payload hash;
- persist evidence durably before/with attestation submission;
- submit its own onchain EpochAttestation signed by the configured observer key;
- idempotently detect an existing matching attestation;
- loud failure if an existing attestation for the same observer/epoch conflicts.

Program submit_attestation requirements:
- signer belongs to mandate's ObserverSet;
- exact epoch/time/window checks;
- exact position set binding;
- algorithm version allowlist;
- one attestation per observer/epoch;
- store integer metrics/hashes/provenance fields;
- no reward accrual here.

Provision instructions for 3 separate observer keys/processes but never commit keys.

Integration tests must run at least 2 observer identities over the same deterministic evidence and prove identical payload hashes.
STOP.
```

---

## Prompt 9 — quorum finalization, unavailable recovery and reward accrual

```text
Implement final epoch settlement.

Instructions:
- finalize_epoch;
- finalize_unavailable_epoch.

finalize_epoch:
- permissionless caller;
- consume bounded attestation accounts;
- verify unique allowed observers;
- enforce mandate observer threshold;
- require exact matching payload/evidence/slot/time/algorithm/metrics/position set;
- reject mismatches rather than averaging;
- create EpochResult once only;
- recompute binary compliance onchain from stored thresholds + attested integer metrics;
- accrue exact deterministic epoch reward only when Compliant;
- final epoch receives exact remainder;
- update counts/accounting.

finalize_unavailable_epoch:
- only after immutable recovery deadline;
- only if no EpochResult exists;
- creates Unavailable result with reward 0;
- never call it NonCompliant;
- no observer/admin shortcut before deadline.

Test:
- 2-of-3 success;
- 1-of-3 failure;
- duplicate observer;
- one mismatched metric/hash;
- exact threshold equals pass;
- one unit fail;
- double finalization;
- final reward remainder;
- unavailable timing;
- observer set substitution;
- replay attestation from another mandate/epoch.

STOP.
```

---

## Prompt 10 — claims, sponsor refunds, closing and full accounting reconciliation

```text
Implement financial exit paths:
- claim_provider_reward;
- withdraw_sponsor_final_refund/surplus;
- close_mandate or safe terminal-state handling.

Requirements:
- provider can claim earned minus claimed only;
- claim destination fixed to accepted provider semantics;
- sponsor can never withdraw earned provider amount;
- sponsor may recover award surplus and, after epoch resolution, unearned amounts;
- pause must not trap exits;
- no admin seizure;
- maintain exact vault conservation invariant;
- avoid closing accounts in a way that destroys unclaimed provider entitlement.

Build reconciliation library + CLI:
- read reward vault;
- calculate deposits, earned, claimed, sponsor withdrawn, remaining obligations;
- fail non-zero on any mismatch.

Add property/state-machine tests over randomized valid instruction sequences.
STOP only after conservation tests pass.
```

---

## Prompt 11 — chain indexer, database, API and production observability

```text
Build the production read/operations plane.

Implement PostgreSQL schema/migrations for all chain/read/evidence objects from TECHNICAL_SPEC.

Indexer:
- subscribe to program state/events;
- durable slot/signature cursor;
- backfill after disconnect;
- idempotent upserts;
- chain account reconciliation;
- reward-vault reconciliation;
- rebuild command from scratch.

Scheduler/queue:
- idempotent observation/finalize/reconcile jobs;
- no duplicate economic transaction from retry;
- exponential backoff with hard dead-letter visibility;
- observer jobs separated by observer identity.

API:
- public typed read routes;
- tx-building endpoints only where useful, no server signing for users;
- input validation, rate limits and provenance/freshness;
- evidence endpoint exposing reproducibility information.

Observability:
- structured logs;
- OpenTelemetry/current equivalent where appropriate;
- Prometheus/current metrics;
- health/readiness;
- observer disagreement/quorum lag/vault mismatch alerts.

Load-test read paths and worker scheduling at hundreds/thousands of mandates without using fake production routes. Synthetic load tests are allowed and must be labelled tests.
STOP.
```

---

## Prompt 12 — production web application and real wallet flows

```text
Build the full Mandate web application against the real API/chain.

Use current official Solana Wallet Standard integration.

Required surfaces:
- landing/product explanation;
- approved markets with real measured current quality;
- explore mandates;
- create mandate wizard;
- mandate detail including exact SLA, bids, provider, position set, epoch timeline, reward accounting and evidence;
- provider workspace for bids, registration and claims;
- methodology page;
- evidence inspector.

Financial write UX:
- build/sign real Solana transactions;
- preview exact raw/display USDC values and irreversible timing;
- pending/confirmed/failed states from chain;
- no optimistic "success" before confirmation;
- never accept private key/seed phrase.

Critical copy:
- distinguish aggregate pool metrics from provider contribution;
- distinguish Compliant, NonCompliant and Unavailable;
- state Mandate measures market quality, not fair value;
- properly describe PreStocks economic exposure.

Add Playwright end-to-end tests on local/fork environments and accessibility/mobile checks.
No mock-data switch in production build.
STOP.
```

---

## Prompt 13 — Surfpool real-state integration, mainnet rehearsal and failure injection

```text
Now prove the whole product against REAL mainnet state safely.

Using current Surfpool docs and a reliable upstream RPC:
1. fork mainnet state containing the exact approved PreStocks mint and Meteora DLMM pool;
2. deploy the Mandate program to the fork/local environment;
3. create/fund test wallets on the fork without fabricating pool state;
4. create a mandate using real pool data;
5. submit at least two bids;
6. accept one;
7. create/use real Meteora position(s) against the forked program/pool if feasible under fork semantics;
8. register exact positions;
9. run multiple independent observer processes;
10. finalize a real compliant measurement where real state actually passes chosen thresholds;
11. change/remove/reposition REAL forked liquidity so a subsequent real measurement fails naturally;
12. restore liquidity and show compliance again;
13. claim reward and sponsor refund;
14. run reconciliation;
15. inject RPC outage, observer disagreement, indexer restart, queue retry and DB rebuild failures.

Do not modify measurement results manually to manufacture pass/fail.
Do not label fork transactions as mainnet.

Produce docs/runbooks/surfpool-e2e.md with exact commands, signatures and observed limitations.
STOP.
```

---

## Prompt 14 — optional Clawpump sponsor gate (DO NOT RUN unless core product is complete)

```text
This is OPTIONAL. Do not execute unless the core Mandate is production-complete and the product owner explicitly wants the Clawpump bounty attempt.

Re-read the CURRENT Stocklana Clawpump bounty and Clawpump docs today.
Call the current authenticated GET /api/v1/pump-pairs and save the exact response/evidence privately (never commit the API key).

Answer before writing code:
1. Is there an economically coherent stock quote pair suitable for the Mandate agent?
2. Can the current bounty requirement "launch your token with a stock-paired liquidity pool using clawpump and Meteora" be satisfied literally?
3. What wallet controls the agent, creator token, creator fees and payout?
4. Which writes are non-idempotent and how will retries be protected?
5. What does the agent do that is genuinely needed by Mandate?

If any answer makes the integration forced or misleading, STOP and recommend not entering the bounty.

If it passes, implement an autonomous Mandate maker agent whose wallet:
- can discover open mandates;
- evaluate the explicit SLA/budget;
- submit a bid only under configured risk/capital limits;
- manage its own approved Meteora liquidity strategy outside the Mandate contract;
- receive real Mandate rewards;
- launch its Clawpump agent token with the required stock-paired Meteora setup;
- use/track creator-fee revenue honestly if it funds operations.

The agent must receive no protocol privilege: it is just a provider wallet.
Use strict spending/position caps and explicit kill switch.
Prove real end-to-end transactions with tiny funds.
STOP.
```

---

## Prompt 15 — final security audit, tiny mainnet proof, deployment and handoff

```text
Perform final production hardening. Read every repo document again.

1. Security review:
- Anchor account constraints/PDA substitution;
- reward conservation;
- observer replay/domain binding;
- quorum uniqueness;
- epoch boundary/time attacks;
- position attribution/free-rider attacks;
- integer overflow/rounding;
- sponsor/provider/admin privilege analysis;
- RPC/evidence trust;
- dependency audit;
- secret scan.

2. Run every unit/property/integration/E2E/load/reconciliation test.

3. Verify reproducible Anchor build and current program verification workflow.

4. Deploy production infrastructure with separate secrets/keys and monitoring.

5. Only after the release checklist passes, execute a deliberately tiny mainnet proof using REAL:
- approved PreStocks/USDC Meteora pool;
- USDC reward escrow;
- two bid wallets;
- registered provider position;
- observer quorum;
- one or more real epochs;
- provider claim.

Do not manufacture a noncompliant mainnet epoch if changing liquidity would be economically unsafe; a fork failure proof plus real mainnet compliant lifecycle is acceptable if labelled precisely.

6. Produce docs/FINAL_HANDOFF.md containing:
- architecture actually built;
- program IDs/deployments and network labels;
- all environment variables with purpose and where to obtain them;
- how to create/secure observer keys;
- database/Redis setup;
- how to run every app/service;
- how to rebuild DB from chain;
- how to reproduce measurement for an epoch;
- how to run local, Surfpool and production test flows;
- current external API/SDK versions;
- current known limitations;
- admin/upgrade authority ownership and rotation plan;
- monitoring/incident steps;
- exact mainnet evidence links/signatures;
- sponsor eligibility evidence if any optional bounty integration was actually completed.

7. Explain every material thing you changed from the original spec and why.

Do not call the project finished until another engineer can follow docs/FINAL_HANDOFF.md from a clean machine.
STOP with a concise final status report, not more feature work.
```
