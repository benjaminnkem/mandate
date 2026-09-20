# Mandate — Deployment and Operations Runbook

This runbook assumes the implementation has completed all prior staged prompts and the release checklist. Replace placeholder commands/paths with the actual repository scripts created during implementation.

## 1. Deployment environments

Maintain at least three isolated environments:

### Development

- local validator for pure program tests;
- local Postgres/Redis;
- deterministic fixtures permitted only inside tests.

### Staging / mainnet-fork

- Surfpool fork of current mainnet state;
- real PreStocks mint and real Meteora program/pool data;
- staging DB/Redis/evidence store;
- staging observer keys;
- no production admin/deploy keys.

### Production / mainnet-beta

- verified program;
- dedicated RPC/WebSocket;
- production DB/Redis/object storage;
- separate observer keys;
- tightly controlled admin/deploy authorities;
- tiny initial economic limits until confidence grows.

Never share a database, observer key or admin key across environments.

---

## 2. Pre-deployment release gates

All of the following must pass:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
cargo test --workspace
anchor build
pnpm build
pnpm test:e2e
pnpm test:integration
pnpm security:scan
pnpm reconcile:test
```

And:

- Surfpool end-to-end passed;
- observer 2-of-3 matching proven;
- observer disagreement tested;
- vault conservation tests passed;
- DB rebuild from chain tested;
- deploy/program build reproducible;
- dependency/secret audit clean;
- current PreStocks API and exact market reverified on deployment day;
- current Meteora SDK/program docs rechecked;
- `docs/RELEASE_CHECKLIST.md` complete.

Do not waive a failed financial invariant because of hackathon timing.

---

## 3. Production key plan

### Deploy/upgrade authority

- offline/hardware-protected where possible;
- not mounted in API/indexer/observer containers;
- transfer to multisig/timelock after hackathon if project continues.

### Protocol admin

Permissions limited to:

- new protocol bounds where upgrade design permits;
- new ObserverSet versions;
- market enable/disable for future mandates;
- pause new risk.

No reward-vault withdrawal authority.

### Observer keys

Target initial production configuration:

```text
observer-1
observer-2
observer-3
threshold = 2
```

Operational requirements:

- encrypted at rest;
- separate machines/secret stores when practical;
- at least two distinct RPC configurations;
- low SOL balance sufficient for attestation fees;
- alarms on unexpected transactions.

### Scheduler relayer

Optional, low-balance fee payer only. No admin role.

### Human user wallets

Never stored by Mandate infrastructure.

---

## 4. Database/queue deployment

Provision PostgreSQL with:

- automated backups;
- point-in-time recovery if available;
- TLS;
- least-privilege service users;
- migration role separated where practical.

Provision Redis/queue with:

- persistence appropriate for job durability;
- auth/TLS;
- dead-letter visibility;
- namespace per environment.

Deploy migrations before app rollout:

```bash
pnpm db:migrate:deploy
```

Never let web/API containers auto-run destructive migrations.

---

## 5. Evidence storage

Provision durable object storage if used.

Requirements:

- versioning recommended;
- lifecycle long enough to cover audit/submission;
- write credentials only in observer infrastructure;
- evidence hash verified before serving;
- no secrets in objects.

Test a read-back/hash verification before starting observers.

---

## 6. RPC setup

Production requires a reliable Solana RPC provider with:

- HTTP + WebSocket;
- adequate `getProgramAccounts`/account read support for Meteora/indexer;
- sufficient rate limits;
- transaction submission;
- historical/signature queries needed for backfill.

Observer diversity:

- Observer 1: Provider A
- Observer 2: Provider B if possible
- Observer 3: Provider A/B or independent endpoint

Do not assume provider diversity automatically means state independence, but it reduces single endpoint failure.

Set alerts for:

- latency spikes;
- rate-limit responses;
- WebSocket disconnect;
- slot lag;
- observer slot divergence.

---

## 7. Program deployment

### Build

Use pinned toolchain:

```bash
anchor build
```

Record:

- git commit;
- Rust/Anchor/Solana versions;
- program binary hash;
- IDL hash;
- lockfiles.

### Deploy staging/fork/devnet first

Run complete lifecycle.

### Mainnet

Only after explicit release approval:

```bash
anchor deploy --provider.cluster mainnet
```

Use the actual verified current command/config.

Immediately record:

- program ID;
- deployment signature;
- upgrade authority;
- programdata address;
- build verification evidence.

Run current `anchor verify`/Solana reproducible verification workflow if available and supported.

---

## 8. Initialize protocol

On mainnet, use intentionally conservative initial bounds.

Initialize:

- USDC mint/token program;
- budget ranges;
- epoch ranges;
- duration limits;
- spread/band safety bounds;
- unavailable recovery duration;
- max positions.

Verify ProtocolConfig independently after transaction.

Do not initialize from web UI without a reviewed admin script that prints exact values before signing.

---

## 9. Create ObserverSet

Generate observer pubkeys before transaction.

Create immutable set version 1:

```text
[observer1, observer2, observer3]
threshold 2
```

Read back account and compare exact keys.

Observers must refuse to start if their own public key is not present in the configured expected set for mandates they are asked to observe.

---

## 10. Approve first market

This is an operational review, not one button.

On deployment day:

1. fetch `https://prestocks.com/api/prestocks`;
2. validate chosen asset exact mint;
3. inspect mint/token extensions;
4. use official Meteora SDK to discover/verify base/USDC DLMM pool;
5. read active bin/fee info;
6. run small read-only two-sided probe;
7. inspect at least one position account;
8. confirm pool/mint orientation;
9. check PreStocks page for action-required/deprecation/lifecycle issue;
10. write dated review file/hash;
11. admin signs `upsert_market`.

Recommended first Stocklana market should be whichever **current** real PreStocks/USDC DLMM pool has reliable enough state and safe tiny-LP economics. Do not hardcode OPENAI/ANTHROPIC before current verification.

---

## 11. Deploy application services

Suggested order:

1. DB/Redis/evidence storage;
2. API;
3. indexer;
4. web;
5. observers;
6. scheduler/finalizer;
7. monitoring/alerts.

Health gates before next stage.

### API readiness

Checks:

- DB reachable;
- chain reachable;
- correct program ID/network;
- PreStocks adapter healthy or honestly degraded;
- no signer requirement.

### Indexer readiness

- chain cursor established;
- subscription active;
- backfill current;
- zero reconciliation mismatch.

### Observer readiness

- key loaded;
- expected pubkey matches;
- real pool measurement works;
- evidence storage write/read/hash works;
- attestation simulation works;
- no money-moving authority beyond observer signer.

### Scheduler readiness

- queue reachable;
- program correct;
- relayer has limited fee balance;
- duplicate-job protection active.

---

## 12. First production mandate — tiny canary

Use deliberately low reward and liquidity exposure.

Suggested sequence:

1. Sponsor connects wallet.
2. Create mandate with reasonable thresholds based on current read-only measurements, not thresholds designed to guarantee pass.
3. Escrow small real USDC.
4. Two distinct provider wallets submit real bids.
5. Sponsor accepts one.
6. Provider creates/uses a small real Meteora position and registers exact key(s).
7. Activate.
8. Observe at least one full legitimate epoch.
9. Confirm observer 2-of-3 matching.
10. Finalize.
11. Provider claims earned real USDC.
12. Reconcile vault.

Do not intentionally yank meaningful mainnet liquidity merely to produce a red screenshot. Use Surfpool to prove destructive/failure scenarios if needed.

---

## 13. Post-deployment reconciliation

After every release and during canary:

```bash
pnpm reconcile --network mainnet-beta
```

Expected:

```text
reward_vault_mismatch_raw = 0
missing_epoch_results = 0 (except legitimately pending)
indexer_slot_lag within SLO
observer disagreements = 0 or investigated
```

Any non-zero vault mismatch is incident severity high.

---

## 14. Monitoring dashboard

Minimum panels:

### Chain

- current Solana slot;
- indexer slot;
- RPC status;
- transaction failures.

### Observers

- last successful measurement per observer;
- payload hash agreement;
- slot skew;
- attestation lag;
- key SOL balance.

### Mandates

- active count;
- epochs pending/quorum/finalized/unavailable;
- reward escrow total;
- earned/claimed/refundable USDC;
- reconciliation difference.

### Services

- API latency/errors;
- DB connections;
- Redis queue depth;
- worker failures;
- evidence storage failures.

---

## 15. Incident playbooks

### A. Observer disagreement

1. Stop automatic finalization for affected epoch/market if threshold has not already legitimately matched.
2. Preserve all evidence.
3. Compare slots/account snapshots/SDK versions/config.
4. Determine infrastructure vs code divergence.
5. Fix only future jobs; do not rewrite finalized epoch.
6. Publish incident note if user economics affected.

### B. One observer down

2-of-3 continues. Repair promptly.

Do not rotate active mandate observer set.

### C. Two observers down

No quorum.

- preserve pending epoch;
- attempt recovery/backfill within contractual window;
- communicate Unavailable risk;
- do not fabricate/administratively mark pass/fail.

### D. Indexer outage

Financial chain operations remain valid.

- restart;
- backfill from last durable cursor;
- reconcile;
- UI marks stale until current.

### E. RPC outage

Switch configured failover carefully.

Observers should not silently change snapshot semantics mid-job; restart/recompute the epoch evidence according to algorithm rules.

### F. PreStocks API outage

Active market chain measurement can continue if exact mint/pool known and no lifecycle safety signal is required for settlement.

New market onboarding disabled; UI marks metadata unavailable.

### G. Meteora SDK breaking update

Pinned production version remains. Do not hot-upgrade during active mandate. Research/test new version, bump algorithm version for future mandates if measurement changes.

### H. Program vulnerability

- pause new risk if possible;
- do not block legitimate provider claims/refunds;
- secure upgrade/admin authority;
- assess active mandate impact;
- do not use upgrade to retroactively steal/change earned amounts;
- disclose incident.

---

## 16. Upgrades

Program upgrades must include:

- migration plan for every account version;
- invariant tests against previous state;
- observer algorithm compatibility analysis;
- staging/fork replay;
- reproducible build;
- explicit authority approval.

An algorithm change should generally apply only to new mandates because active providers bid against known measurement rules.

---

## 17. Observer algorithm release

For each algorithm version publish:

```text
version
source git commit
lockfile hash
Meteora SDK version
canonical serialization version
search constants
snapshot policy
known limitations
golden vector hashes
```

Observers refuse to sign an unsupported algorithm version.

---

## 18. Clawpump optional deployment

Only if sponsor gate passed.

Separate Clawpump agent environment from core services.

Steps:

1. create/verify agent + wallet;
2. apply risk/spend limits;
3. verify `/pump-pairs` live;
4. preflight token launch/cost;
5. launch with tiny funds satisfying current requirement;
6. verify exact token mint, paired asset, Meteora pool and payout wallet;
7. run agent as a normal Mandate provider;
8. monitor earnings/positions;
9. document kill switch.

If Clawpump service fails, human providers/core protocol continue.

---

## 19. Submission-day freeze

Several hours before deadline:

- stop feature work;
- pin deployed commit;
- rerun full test/reconciliation suite;
- verify live app from clean browser/device;
- verify all links/signatures;
- verify no API keys in repo/history/build output;
- re-read current hackathon sponsor wording;
- prepare `docs/submission/EVIDENCE.md`;
- record current limitations honestly;
- submit early enough to edit if a link is wrong.

Do not redeploy program immediately before recording demo unless necessary.

---

## 20. Final handoff requirements

`docs/FINAL_HANDOFF.md` generated by final Codex prompt must include:

- architecture actually deployed;
- exact versions;
- program IDs/authorities;
- market configs;
- ObserverSet pubkeys/threshold;
- all env variables;
- deployment commands;
- start/stop commands for every service;
- backup/recovery;
- DB rebuild;
- evidence reproduction;
- Surfpool flow;
- mainnet canary proof;
- reconciliation procedure;
- monitoring URLs/panels (without secrets);
- incident contacts/process;
- sponsor integration evidence;
- known risks/open work.
