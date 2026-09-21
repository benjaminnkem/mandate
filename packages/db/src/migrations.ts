/**
 * Ordered, append-only migrations. Never edit an applied migration: `migrate` refuses a changed checksum.
 * Every table below is derived state: the chain (and the evidence store) is the source of truth, and
 * `pnpm indexer rebuild` can recreate all of it (docs/TECHNICAL_SPEC.md section 12).
 *
 * Conventions: addresses and signatures are the natural keys; u64 amounts are NUMERIC(20,0) (exact);
 * timestamps are unix seconds as BIGINT; `data` holds the full decoded record as JSON with u64 as strings;
 * `slot` is the slot the row was last read at, and writes never move it backwards.
 */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_read_model",
    sql: `
CREATE TABLE chain_cursor (
  name           TEXT PRIMARY KEY,
  last_signature TEXT,
  last_slot      BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw program events, kept with signature and slot. Never the sole source of financial state.
CREATE TABLE indexed_events (
  signature   TEXT   NOT NULL,
  event_index INT    NOT NULL,
  slot        BIGINT NOT NULL,
  block_time  BIGINT,
  name        TEXT   NOT NULL,
  mandate     TEXT,
  data        JSONB  NOT NULL,
  PRIMARY KEY (signature, event_index)
);
CREATE INDEX indexed_events_mandate ON indexed_events (mandate, slot);

CREATE TABLE observer_sets (
  address TEXT PRIMARY KEY,
  version INT NOT NULL,
  slot    BIGINT NOT NULL,
  data    JSONB NOT NULL
);

CREATE TABLE markets (
  address TEXT PRIMARY KEY,
  pool    TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL,
  slot    BIGINT NOT NULL,
  data    JSONB NOT NULL
);

CREATE TABLE mandates (
  address         TEXT PRIMARY KEY,
  sponsor         TEXT NOT NULL,
  provider        TEXT,
  market_config   TEXT NOT NULL,
  status          TEXT NOT NULL,
  start_at        BIGINT NOT NULL,
  end_at          BIGINT NOT NULL,
  total_epochs    INT NOT NULL,
  finalized_epochs INT NOT NULL,
  max_reward_raw  NUMERIC(20,0) NOT NULL,
  earned_raw      NUMERIC(20,0) NOT NULL,
  claimed_raw     NUMERIC(20,0) NOT NULL,
  slot            BIGINT NOT NULL,
  data            JSONB NOT NULL
);
CREATE INDEX mandates_status ON mandates (status, start_at);
CREATE INDEX mandates_provider ON mandates (provider);
CREATE INDEX mandates_sponsor ON mandates (sponsor);
CREATE INDEX mandates_market ON mandates (market_config);

CREATE TABLE bids (
  address  TEXT PRIMARY KEY,
  mandate  TEXT NOT NULL,
  provider TEXT NOT NULL,
  status   TEXT NOT NULL,
  slot     BIGINT NOT NULL,
  data     JSONB NOT NULL
);
CREATE INDEX bids_mandate ON bids (mandate);

CREATE TABLE position_sets (
  address  TEXT PRIMARY KEY,
  mandate  TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  slot     BIGINT NOT NULL,
  data     JSONB NOT NULL
);

CREATE TABLE epoch_attestations (
  address       TEXT PRIMARY KEY,
  mandate       TEXT NOT NULL,
  epoch_index   INT  NOT NULL,
  observer      TEXT NOT NULL,
  payload_hash  TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  observed_slot BIGINT NOT NULL,
  slot          BIGINT NOT NULL,
  data          JSONB NOT NULL,
  UNIQUE (mandate, epoch_index, observer)
);

CREATE TABLE epoch_results (
  address       TEXT PRIMARY KEY,
  mandate       TEXT NOT NULL,
  epoch_index   INT  NOT NULL,
  outcome       TEXT NOT NULL,
  reward_earned_raw NUMERIC(20,0) NOT NULL,
  evidence_hash TEXT NOT NULL,
  slot          BIGINT NOT NULL,
  data          JSONB NOT NULL,
  UNIQUE (mandate, epoch_index)
);

-- Money movements, from events (the mandate's counters remain the authority; reconciliation compares them).
CREATE TABLE reward_claims (
  signature   TEXT NOT NULL,
  event_index INT  NOT NULL,
  mandate     TEXT NOT NULL,
  provider    TEXT NOT NULL,
  amount_raw  NUMERIC(20,0) NOT NULL,
  slot        BIGINT NOT NULL,
  block_time  BIGINT,
  PRIMARY KEY (signature, event_index)
);
CREATE TABLE sponsor_withdrawals (
  signature   TEXT NOT NULL,
  event_index INT  NOT NULL,
  mandate     TEXT NOT NULL,
  sponsor     TEXT NOT NULL,
  amount_raw  NUMERIC(20,0) NOT NULL,
  slot        BIGINT NOT NULL,
  block_time  BIGINT,
  PRIMARY KEY (signature, event_index)
);

-- One row per evidence hash: what a third party needs to reproduce the measurement.
CREATE TABLE measurement_evidence (
  evidence_hash    TEXT PRIMARY KEY,
  payload_hash     TEXT NOT NULL,
  snapshot_sha256  TEXT,
  algorithm_version INT NOT NULL,
  source_commit    TEXT,
  lockfile_sha256  TEXT,
  observed_slot    BIGINT NOT NULL,
  observed_unix_ts BIGINT NOT NULL,
  storage_uri      TEXT,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vault_reconciliations (
  mandate      TEXT PRIMARY KEY,
  checked_at   TIMESTAMPTZ NOT NULL,
  slot         BIGINT NOT NULL,
  ok           BOOLEAN NOT NULL,
  expected_raw NUMERIC(20,0) NOT NULL,
  actual_raw   NUMERIC(20,0),
  findings     JSONB NOT NULL
);

-- Idempotent work queue. The key is the idempotency key: a second enqueue of the same key is a no-op.
CREATE TABLE jobs (
  key          TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  owner        TEXT,
  payload      JSONB NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','dead')),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL,
  run_at       TIMESTAMPTZ NOT NULL,
  lease_until  TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
CREATE INDEX jobs_claim ON jobs (state, run_at);
CREATE INDEX jobs_kind_owner ON jobs (kind, owner);

CREATE TABLE jobs_audit (
  id      BIGSERIAL PRIMARY KEY,
  key     TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL,
  event   TEXT NOT NULL,
  attempt INT NOT NULL,
  detail  TEXT
);
CREATE INDEX jobs_audit_key ON jobs_audit (key, id);
`,
  },
];
