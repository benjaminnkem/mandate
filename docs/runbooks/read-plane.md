# Runbook: read plane (indexer, scheduler, API)

All services log JSON, expose `/healthz` (up), `/readyz` (usable and fresh) and `/metrics`. Ports: API `PORT`
(3001), indexer `OPS_PORT` (9101), scheduler `OPS_PORT` (9102), observer worker `OBSERVER_OPS_PORT` (9103).

## Start

```bash
DATABASE_URL=postgresql://... pnpm db:migrate
pnpm --filter @mandate/indexer start      # backfills, subscribes, reconciles vaults
pnpm --filter @mandate/scheduler start    # plans jobs; runs finalize if SCHEDULER_RELAYER_KEYPAIR_PATH is set
pnpm --filter @mandate/api start
node apps/observer/src/cli.ts work        # one process per observer key; runs only that key's jobs
```

## The database is disposable

```bash
pnpm indexer:rebuild     # DESTRUCTIVE to derived tables (keeps jobs); re-derives everything from the chain
```

## Alerts and first response

| Alert | First step |
| --- | --- |
| `MandateVaultMismatch` / `MandateVaultErrorNonZero` | `pnpm reconcile:mandate <mandate>`; compare with the API `vaultReconciliation`; treat as an incident, pause new risk if funds may be at risk |
| `ObserverDisagreement` | fetch each observer's evidence bundle (`/v1/mandates/<m>/evidence/<epoch>`), replay, find the divergent input; never average |
| `DeadLetteredJobs` | `SELECT key, last_error FROM jobs WHERE state='dead'`; history in `jobs_audit`; fix the cause, then delete the row so the planner can recreate it |
| `IndexerBehind` / `IndexerStalled` | check RPC health and WebSocket; the periodic pass still converges |
| `EpochQuorumLate` | check each observer worker's `/readyz` and dead jobs |

## Known race to watch

After an epoch's recovery deadline, `finalize_unavailable_epoch` can be sent by anyone, and would beat a late quorum
(ADR 0016). The scheduler finalizes as soon as a quorum exists; keep it healthy.
