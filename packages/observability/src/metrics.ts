import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600];

/**
 * The operational metrics of docs/TECHNICAL_SPEC.md section 26, one registry per process. Names are stable: the
 * alert rules in `ops/alerts/mandate.rules.yml` refer to them.
 */
export function createMetrics(service: string, registry = new Registry()) {
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  const counter = (name: string, help: string, labelNames: string[] = []) =>
    new Counter({ name, help, labelNames, registers: [registry] });
  const gauge = (name: string, help: string, labelNames: string[] = []) =>
    new Gauge({ name, help, labelNames, registers: [registry] });
  const histogram = (name: string, help: string, labelNames: string[] = [], buckets = SECONDS) =>
    new Histogram({ name, help, labelNames, buckets, registers: [registry] });

  return {
    registry,
    observerEpochJobs: counter("observer_epoch_jobs_total", "Observer epoch jobs by result", [
      "result",
    ]),
    observerEpochFailures: counter(
      "observer_epoch_failures_total",
      "Observer epoch jobs that failed",
    ),
    observerPayloadDisagreements: counter(
      "observer_payload_disagreements_total",
      "Times an observer's payload disagreed with a peer's",
    ),
    observerRpcSlotSkew: gauge(
      "observer_rpc_slot_skew",
      "Slots between the RPC used and the newest known slot",
    ),
    attestationSubmissionLatency: histogram(
      "attestation_submission_latency_seconds",
      "Time from epoch end to an attestation landing",
    ),
    epochQuorumLatency: histogram(
      "epoch_quorum_latency_seconds",
      "Time from epoch end to the threshold attestation",
    ),
    epochFinalizationLatency: histogram(
      "epoch_finalization_latency_seconds",
      "Time from epoch end to its EpochResult",
    ),
    indexerSlotLag: gauge("indexer_slot_lag", "Slots the indexer is behind the chain"),
    indexerLastSyncTimestamp: gauge(
      "indexer_last_sync_timestamp_seconds",
      "Unix time of the last completed sync",
    ),
    indexerEvents: counter("indexer_events_total", "Program events recorded", ["name"]),
    vaultReconciliationErrorRaw: gauge(
      "reward_vault_reconciliation_error_raw",
      "Largest absolute vault-versus-ledger difference across mandates, raw USDC units",
    ),
    vaultReconciliationFailures: gauge(
      "reward_vault_reconciliation_failures",
      "Mandates whose books do not reconcile",
    ),
    apiRequestLatency: histogram("api_request_latency_seconds", "API request latency", [
      "route",
      "status",
    ]),
    queueDepth: gauge("queue_depth", "Jobs by kind and state", ["kind", "state"]),
    deadJobs: gauge("queue_dead_jobs", "Dead-lettered jobs awaiting an operator"),
    duplicateJobAttempts: counter(
      "job_duplicate_attempts_total",
      "Enqueue or execution attempts that hit an existing or conflicting job",
      ["kind"],
    ),
    jobRuns: counter("job_runs_total", "Job executions by kind and outcome", ["kind", "outcome"]),
    marketReadable: gauge(
      "market_pool_readable",
      "1 if the market pool account is readable and valid",
      ["pool"],
    ),
  };
}
export type Metrics = ReturnType<typeof createMetrics>;
