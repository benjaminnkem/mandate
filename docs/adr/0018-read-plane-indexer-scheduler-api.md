# ADR 0018: Read plane, indexer, scheduler, API and observability (Prompt 11)

- Status: accepted
- Date: 2026-09-22

## Decisions

1. **The database is derived state and can always be rebuilt.** `packages/db` holds append-only migrations
   (checksummed; an edited applied migration refuses to run) for chain cursor, raw events, observer sets, markets,
   mandates, bids, position sets, attestations, epoch results, claims, sponsor withdrawals, measurement evidence, vault
   reconciliations and the job queue. u64 amounts are `NUMERIC(20,0)` and travel as decimal strings in both drivers,
   never as JavaScript numbers. `pnpm indexer:rebuild` truncates everything derived (the queue is kept) and re-derives it
   from the chain.
2. **Accounts are the truth; events are hints.** The indexer decodes program accounts with the IDL and upserts them
   keyed by address, guarded by slot (`WHERE existing.slot <= new.slot`), so replays, retries and out-of-order reads can
   never move a row backwards. Events are stored with signature, slot and event index (idempotent), feed
   `reward_claims` / `sponsor_withdrawals` history, and tell the indexer which accounts to re-read. A test proves an
   event claiming a large `total_claimed_raw` cannot change what the read model shows.
3. **Convergence does not depend on the WebSocket.** A full account pass (which also deletes rows for accounts the chain
   no longer has) plus a signature backfill from a durable cursor runs every interval. The cursor advances only past a
   fully processed signature, and processing is idempotent, so a crash repeats work and never skips it.
4. **Vault reconciliation runs continuously.** For every mandate the indexer compares counters, epoch results and the
   real vault balance (`reconcileMandate`, ADR 0017), stores the outcome, exports
   `reward_vault_reconciliation_failures` / `_error_raw`, and `/readyz` reports not-ready while any mandate fails.
5. **The queue is Postgres, with the key as the idempotency key.** `enqueue` never re-creates a job that exists in any
   state, including succeeded, so a planner or retry cannot duplicate an economic job. Workers lease with
   `FOR UPDATE SKIP LOCKED`; failures retry with exponential backoff and become `dead` (visible in metrics, readiness,
   the audit log and logs) at the attempt limit; "not yet" (`defer`) never spends an attempt; a worker that died
   is re-leased. Observe jobs carry an `owner` (the observer's public key) and are claimable only by that identity;
   the observer CLI's `work` mode runs only jobs owned by its own key.
6. **Finalization is scheduled but permissionless.** The scheduler plans, per active mandate epoch ending within the
   lookahead, one `finalize` job plus one `observe` job per observer, atomically in batches. The finalize handler
   re-reads the chain before acting: result exists means done; epoch not ended or quorum not yet formed means defer;
   a quorum of exactly agreeing attestations sends `finalize_epoch` with exactly those attestations; no quorum at the
   recovery deadline sends `finalize_unavailable_epoch`; a failed send re-checks and treats a lost race as success.
   Two conflicting quorums are dead-lettered for an operator instead of picking one. The relayer key is optional, only
   pays fees and holds no authority. Deviation from the specification: `reconcile` is not a queued job; the indexer's
   periodic pass owns it because it simply overwrites one row.
7. **The API is read-first and never signs.** Public typed routes validate every input with zod, are rate limited
   (health and metrics exempt), and wrap every chain-derived response with network, program id, indexed slot and
   staleness. Transaction endpoints (`claim`, `withdraw`, `submit-bid`, `accept-bid`, `register-positions`) return an
   unsigned transaction with a short-lived blockhash and an economic summary whose numbers are recomputed from chain
   state, and they refuse actions the program would refuse. `create-mandate` is left to the web client
   (Prompt 12) because it needs the protocol account and a full wizard. The evidence endpoint returns the attested
   hashes, whether observers agreed, and the exact parameters to replay the measurement offline.
8. **Observability.** Prometheus metrics for every item in specification section 26, `/healthz` `/readyz` `/metrics`
   on every service (workers use a small ops server), OpenTelemetry API spans that cost nothing until a deployment
   registers an SDK, and `ops/alerts/mandate.rules.yml`; a test fails if an alert refers to a metric the code does not
   export.
9. **Load testing is synthetic and says so.** `@mandate/testkit` fabricates labelled data (`SYNTHETIC-TEST-FIXTURE`)
   only for tests. `pnpm test:load` (default 3000 / 2000 mandates) exercises reads and scheduling; no production route
   serves fixtures.

## Measured (synthetic, real PostgreSQL 2000 mandates, 72 epochs each, local machine, not a benchmark of production)

- Reads: mandate detail p95 55 ms, epoch timeline p95 20 ms, bids p95 14 ms, provider list p95 14 ms; a full keyset
  walk of 2000 mandates in 107 ms.
- Scheduling: 36,000 due epochs planned into 144,000 jobs in 6.4 s (one batched pass; steady state is a few epochs per
  tick), then drained by 4 parallel workers exactly once each at about 1,500 jobs/s, with observe jobs never crossing
  identities.

## Known limits

- The indexer's full account pass uses `getProgramAccounts`, which is fine at hundreds to low thousands of mandates but
  should move to targeted refreshes (already used for events) plus a slower full pass at larger scale.
- Only filesystem evidence storage exists on the observer side, so the API's evidence endpoint links to
  `EVIDENCE_PUBLIC_BASE_URL` when configured and otherwise states that the bundle is not registered.
- Live-chain behavior (WebSocket, real RPC pagination) is verified against an in-memory chain that implements the same
  interface; the Surfpool end-to-end run is Prompt 13.
- No Redis is used; Postgres is the queue. `REDIS_URL` in the scheduler environment is currently unused.
