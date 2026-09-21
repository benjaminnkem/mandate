import type { Queryable } from "./db.ts";

/** JSON-safe decoded account: u64/i64 as decimal strings, keys as base58, hashes as hex. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonRecord = { [key: string]: Json };

export const ACCOUNT_KINDS = [
  "ObserverSet",
  "MarketConfig",
  "Mandate",
  "Bid",
  "PositionSet",
  "EpochAttestation",
  "EpochResult",
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

const DEFAULT_KEY = "11111111111111111111111111111111";

const str = (d: JsonRecord, k: string): string => {
  const v = d[k];
  if (typeof v !== "string") throw new Error(`decoded account is missing string field ${k}`);
  return v;
};
const num = (d: JsonRecord, k: string): number => {
  const v = d[k];
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  throw new Error(`decoded account is missing integer field ${k}`);
};
const bool = (d: JsonRecord, k: string): boolean => {
  const v = d[k];
  if (typeof v !== "boolean") throw new Error(`decoded account is missing boolean field ${k}`);
  return v;
};
const optionalKey = (d: JsonRecord, k: string): string | null => {
  const v = str(d, k);
  return v === DEFAULT_KEY ? null : v;
};

interface Upsert {
  readonly table: string;
  readonly columns: readonly string[];
  readonly values: readonly unknown[];
}

function plan(kind: AccountKind, d: JsonRecord): Upsert {
  switch (kind) {
    case "ObserverSet":
      return { table: "observer_sets", columns: ["version"], values: [num(d, "version")] };
    case "MarketConfig":
      return {
        table: "markets",
        columns: ["pool", "enabled"],
        values: [str(d, "pool"), bool(d, "enabled")],
      };
    case "Mandate":
      return {
        table: "mandates",
        columns: [
          "sponsor",
          "provider",
          "market_config",
          "status",
          "start_at",
          "end_at",
          "total_epochs",
          "finalized_epochs",
          "max_reward_raw",
          "earned_raw",
          "claimed_raw",
        ],
        values: [
          str(d, "sponsor"),
          optionalKey(d, "provider"),
          str(d, "marketConfig"),
          str(d, "status"),
          str(d, "startAt"),
          str(d, "endAt"),
          num(d, "totalEpochs"),
          num(d, "finalizedEpochs"),
          str(d, "maxRewardRaw"),
          str(d, "earnedRewardRaw"),
          str(d, "claimedRewardRaw"),
        ],
      };
    case "Bid":
      return {
        table: "bids",
        columns: ["mandate", "provider", "status"],
        values: [str(d, "mandate"), str(d, "provider"), str(d, "status")],
      };
    case "PositionSet":
      return {
        table: "position_sets",
        columns: ["mandate", "provider"],
        values: [str(d, "mandate"), str(d, "provider")],
      };
    case "EpochAttestation":
      return {
        table: "epoch_attestations",
        columns: [
          "mandate",
          "epoch_index",
          "observer",
          "payload_hash",
          "evidence_hash",
          "observed_slot",
        ],
        values: [
          str(d, "mandate"),
          num(d, "epochIndex"),
          str(d, "observer"),
          str(d, "payloadHash"),
          str(d, "evidenceHash"),
          str(d, "observedSlot"),
        ],
      };
    case "EpochResult":
      return {
        table: "epoch_results",
        columns: ["mandate", "epoch_index", "outcome", "reward_earned_raw", "evidence_hash"],
        values: [
          str(d, "mandate"),
          num(d, "epochIndex"),
          str(d, "outcome"),
          str(d, "rewardEarnedRaw"),
          str(d, "evidenceHash"),
        ],
      };
  }
}

/**
 * Write one decoded chain account. Idempotent and order-safe: a row is only replaced by data read at the same or a
 * later slot, so replays, retries and out-of-order deliveries can never move state backwards. Returns whether the
 * row was written.
 */
export async function upsertAccount(
  q: Queryable,
  kind: AccountKind,
  address: string,
  slot: bigint,
  data: JsonRecord,
): Promise<boolean> {
  const p = plan(kind, data);
  const cols = ["address", ...p.columns, "slot", "data"];
  const params = [address, ...p.values, slot.toString(), JSON.stringify(data)];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const updates = cols
    .slice(1)
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");
  const result = await q.query(
    `INSERT INTO ${p.table} (${cols.join(", ")}) VALUES (${placeholders})
     ON CONFLICT (address) DO UPDATE SET ${updates} WHERE ${p.table}.slot <= EXCLUDED.slot`,
    params,
  );
  return result.rowCount > 0;
}

/** Remove an account that no longer exists on chain (a closed or reclaimed account). */
export async function deleteAccount(
  q: Queryable,
  kind: AccountKind,
  address: string,
): Promise<void> {
  await q.query(`DELETE FROM ${plan(kind, EMPTY[kind]).table} WHERE address = $1`, [address]);
}
// Table name lookup only; values are never read.
const EMPTY: Record<AccountKind, JsonRecord> = {
  ObserverSet: { version: 0 },
  MarketConfig: { pool: "", enabled: false },
  Mandate: {
    sponsor: "",
    provider: DEFAULT_KEY,
    marketConfig: "",
    status: "",
    startAt: "0",
    endAt: "0",
    totalEpochs: 0,
    finalizedEpochs: 0,
    maxRewardRaw: "0",
    earnedRewardRaw: "0",
    claimedRewardRaw: "0",
  },
  Bid: { mandate: "", provider: "", status: "" },
  PositionSet: { mandate: "", provider: "" },
  EpochAttestation: {
    mandate: "",
    epochIndex: 0,
    observer: "",
    payloadHash: "",
    evidenceHash: "",
    observedSlot: "0",
  },
  EpochResult: { mandate: "", epochIndex: 0, outcome: "", rewardEarnedRaw: "0", evidenceHash: "" },
};

export interface EventRow {
  readonly signature: string;
  readonly eventIndex: number;
  readonly slot: bigint;
  readonly blockTime: number | null;
  readonly name: string;
  readonly mandate: string | null;
  readonly data: JsonRecord;
}

/** Record a raw program event (idempotent on signature + event index), plus the money-movement tables. */
export async function insertEvent(q: Queryable, e: EventRow): Promise<boolean> {
  const inserted = await q.query(
    `INSERT INTO indexed_events (signature, event_index, slot, block_time, name, mandate, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [
      e.signature,
      e.eventIndex,
      e.slot.toString(),
      e.blockTime,
      e.name,
      e.mandate,
      JSON.stringify(e.data),
    ],
  );
  if (inserted.rowCount === 0) return false;
  const amount = e.data["amountRaw"];
  if (typeof amount === "string" && e.mandate) {
    if (e.name === "ProviderRewardClaimed")
      await q.query(
        `INSERT INTO reward_claims (signature, event_index, mandate, provider, amount_raw, slot, block_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [
          e.signature,
          e.eventIndex,
          e.mandate,
          str(e.data, "provider"),
          amount,
          e.slot.toString(),
          e.blockTime,
        ],
      );
    if (e.name === "SponsorSurplusWithdrawn")
      await q.query(
        `INSERT INTO sponsor_withdrawals (signature, event_index, mandate, sponsor, amount_raw, slot, block_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [
          e.signature,
          e.eventIndex,
          e.mandate,
          str(e.data, "sponsor"),
          amount,
          e.slot.toString(),
          e.blockTime,
        ],
      );
  }
  return true;
}

export interface Cursor {
  readonly lastSignature: string | null;
  readonly lastSlot: bigint;
}

export async function getCursor(q: Queryable, name: string): Promise<Cursor> {
  const { rows } = await q.query<{ last_signature: string | null; last_slot: string }>(
    "SELECT last_signature, last_slot FROM chain_cursor WHERE name=$1",
    [name],
  );
  const r = rows[0];
  return { lastSignature: r?.last_signature ?? null, lastSlot: BigInt(r?.last_slot ?? "0") };
}

export async function setCursor(q: Queryable, name: string, cursor: Cursor): Promise<void> {
  await q.query(
    `INSERT INTO chain_cursor (name, last_signature, last_slot, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (name) DO UPDATE SET last_signature=EXCLUDED.last_signature, last_slot=EXCLUDED.last_slot, updated_at=now()`,
    [name, cursor.lastSignature, cursor.lastSlot.toString()],
  );
}

/** Destructive: drop all derived chain state so the indexer can rebuild it from the chain. Keeps the queue. */
export async function truncateDerived(q: Queryable): Promise<void> {
  await q.exec(
    `TRUNCATE observer_sets, markets, mandates, bids, position_sets, epoch_attestations, epoch_results,
       reward_claims, sponsor_withdrawals, indexed_events, vault_reconciliations, chain_cursor`,
  );
}

export interface EvidenceRow {
  readonly evidenceHash: string;
  readonly payloadHash: string;
  readonly snapshotSha256: string | null;
  readonly algorithmVersion: number;
  readonly sourceCommit: string | null;
  readonly lockfileSha256: string | null;
  readonly observedSlot: bigint;
  readonly observedUnixTs: bigint;
  readonly storageUri: string | null;
}

export async function upsertEvidence(q: Queryable, e: EvidenceRow): Promise<void> {
  await q.query(
    `INSERT INTO measurement_evidence (evidence_hash, payload_hash, snapshot_sha256, algorithm_version, source_commit,
       lockfile_sha256, observed_slot, observed_unix_ts, storage_uri) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (evidence_hash) DO UPDATE SET storage_uri = COALESCE(EXCLUDED.storage_uri, measurement_evidence.storage_uri)`,
    [
      e.evidenceHash,
      e.payloadHash,
      e.snapshotSha256,
      e.algorithmVersion,
      e.sourceCommit,
      e.lockfileSha256,
      e.observedSlot.toString(),
      e.observedUnixTs.toString(),
      e.storageUri,
    ],
  );
}

export interface ReconciliationRow {
  readonly mandate: string;
  readonly checkedAt: Date;
  readonly slot: bigint;
  readonly ok: boolean;
  readonly expectedRaw: bigint;
  readonly actualRaw: bigint | null;
  readonly findings: Json;
}

export async function saveReconciliation(q: Queryable, r: ReconciliationRow): Promise<void> {
  await q.query(
    `INSERT INTO vault_reconciliations (mandate, checked_at, slot, ok, expected_raw, actual_raw, findings)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (mandate) DO UPDATE SET checked_at=EXCLUDED.checked_at, slot=EXCLUDED.slot, ok=EXCLUDED.ok,
       expected_raw=EXCLUDED.expected_raw, actual_raw=EXCLUDED.actual_raw, findings=EXCLUDED.findings`,
    [
      r.mandate,
      r.checkedAt,
      r.slot.toString(),
      r.ok,
      r.expectedRaw.toString(),
      r.actualRaw?.toString() ?? null,
      JSON.stringify(r.findings),
    ],
  );
}

// ---- reads ------------------------------------------------------------------------------------------------

export interface MandateListFilter {
  readonly status?: string;
  readonly provider?: string;
  readonly sponsor?: string;
  readonly market?: string;
  /** Keyset pagination: only mandates with an address greater than this. */
  readonly after?: string;
  readonly limit: number;
}

interface DataRow {
  address: string;
  slot: string;
  data: JsonRecord;
}
export interface Row {
  readonly address: string;
  readonly slot: string;
  readonly data: JsonRecord;
}
const rowOf = (r: DataRow): Row => ({ address: r.address, slot: r.slot, data: r.data });

export async function listMandates(q: Queryable, f: MandateListFilter): Promise<Row[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("status = ?", f.status);
  if (f.provider) add("provider = ?", f.provider);
  if (f.sponsor) add("sponsor = ?", f.sponsor);
  if (f.market) add("market_config = ?", f.market);
  if (f.after) add("address > ?", f.after);
  params.push(f.limit);
  const { rows } = await q.query<DataRow>(
    `SELECT address, slot, data FROM mandates ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY address LIMIT $${params.length}`,
    params,
  );
  return rows.map(rowOf);
}

export async function getMandate(q: Queryable, address: string): Promise<Row | null> {
  const { rows } = await q.query<DataRow>(
    "SELECT address, slot, data FROM mandates WHERE address=$1",
    [address],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

export async function listBids(q: Queryable, mandate: string): Promise<Row[]> {
  const { rows } = await q.query<DataRow>(
    "SELECT address, slot, data FROM bids WHERE mandate=$1 ORDER BY (data->>'createdAt')::bigint, address",
    [mandate],
  );
  return rows.map(rowOf);
}

export async function getPositionSet(q: Queryable, mandate: string): Promise<Row | null> {
  const { rows } = await q.query<DataRow>(
    "SELECT address, slot, data FROM position_sets WHERE mandate=$1",
    [mandate],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

export async function listEpochResults(q: Queryable, mandate: string): Promise<Row[]> {
  const { rows } = await q.query<DataRow>(
    "SELECT address, slot, data FROM epoch_results WHERE mandate=$1 ORDER BY epoch_index",
    [mandate],
  );
  return rows.map(rowOf);
}

export async function listAttestations(
  q: Queryable,
  mandate: string,
  epoch?: number,
): Promise<Row[]> {
  const { rows } = await q.query<DataRow>(
    `SELECT address, slot, data FROM epoch_attestations WHERE mandate=$1 ${epoch === undefined ? "" : "AND epoch_index=$2"}
     ORDER BY epoch_index, observer`,
    epoch === undefined ? [mandate] : [mandate, epoch],
  );
  return rows.map(rowOf);
}

export async function listMarkets(q: Queryable): Promise<Row[]> {
  const { rows } = await q.query<DataRow>("SELECT address, slot, data FROM markets ORDER BY pool");
  return rows.map(rowOf);
}

export async function getMarketByPool(q: Queryable, pool: string): Promise<Row | null> {
  const { rows } = await q.query<DataRow>("SELECT address, slot, data FROM markets WHERE pool=$1", [
    pool,
  ]);
  return rows[0] ? rowOf(rows[0]) : null;
}

/** The newest finalized epoch result of any mandate on this market: its attested, reproducible metrics. */
export async function latestMarketResult(q: Queryable, marketAddress: string): Promise<Row | null> {
  const { rows } = await q.query<DataRow>(
    `SELECT r.address, r.slot, r.data FROM epoch_results r JOIN mandates m ON m.address = r.mandate
     WHERE m.market_config = $1 AND r.outcome <> 'Unavailable'
     ORDER BY (r.data->>'observedUnixTs')::bigint DESC, r.address LIMIT 1`,
    [marketAddress],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

export async function getEvidence(
  q: Queryable,
  evidenceHash: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await q.query("SELECT * FROM measurement_evidence WHERE evidence_hash=$1", [
    evidenceHash,
  ]);
  return rows[0] ?? null;
}

export interface IndexStatus {
  /** Highest slot any indexed row was read at, or 0 if nothing is indexed. */
  readonly indexedSlot: bigint;
  readonly cursorUpdatedAt: Date | null;
  readonly mandates: number;
  readonly reconciliationFailures: number;
}

export async function indexStatus(q: Queryable, cursorName: string): Promise<IndexStatus> {
  const cursor = await q.query<{ last_slot: string; updated_at: Date | string }>(
    "SELECT last_slot, updated_at FROM chain_cursor WHERE name=$1",
    [cursorName],
  );
  const counts = await q.query<{ mandates: string; bad: string }>(
    `SELECT (SELECT count(*) FROM mandates)::text AS mandates,
            (SELECT count(*) FROM vault_reconciliations WHERE NOT ok)::text AS bad`,
  );
  const c = cursor.rows[0];
  return {
    indexedSlot: BigInt(c?.last_slot ?? "0"),
    cursorUpdatedAt: c ? new Date(c.updated_at) : null,
    mandates: Number(counts.rows[0]?.mandates ?? 0),
    reconciliationFailures: Number(counts.rows[0]?.bad ?? 0),
  };
}
