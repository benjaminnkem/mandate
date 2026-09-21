import {
  ACCOUNT_KINDS,
  type AccountKind,
  type Db,
  type JsonRecord,
  deleteAccount,
  getCursor,
  insertEvent,
  saveReconciliation,
  setCursor,
  truncateDerived,
  upsertAccount,
} from "@mandate/db";
import {
  accountKind,
  decodeAccount,
  findEpochResultPda,
  jsonSafe,
  parseProgramEvents,
  reconcileMandate,
  type EpochResultAccount,
  type MandateAccount,
} from "@mandate/solana";
import type { Metrics } from "@mandate/observability";
import { PublicKey } from "@solana/web3.js";

import type { ChainReader } from "./chain.ts";

export const CURSOR_NAME = "program-events";

/** Table each account kind is stored in, for chain reconciliation of deleted accounts. */
const TABLE: Record<AccountKind, string> = {
  ObserverSet: "observer_sets",
  MarketConfig: "markets",
  Mandate: "mandates",
  Bid: "bids",
  PositionSet: "position_sets",
  EpochAttestation: "epoch_attestations",
  EpochResult: "epoch_results",
};

const isKind = (name: string | null): name is AccountKind =>
  name !== null && (ACCOUNT_KINDS as readonly string[]).includes(name);

export interface SyncReport {
  readonly slot: bigint;
  readonly upserted: number;
  readonly stale: number;
  readonly removed: number;
  readonly undecodable: number;
}

/**
 * Keeps the read model equal to the chain. Financial state comes only from decoded ACCOUNT data; events are
 * recorded for history and used as hints for which accounts to re-read, never as the source of a balance.
 */
export class Indexer {
  private readonly db: Db;
  private readonly chain: ChainReader;
  private readonly metrics: Metrics | undefined;
  private readonly log: (message: string, fields?: Record<string, unknown>) => void;

  constructor(deps: {
    db: Db;
    chain: ChainReader;
    metrics?: Metrics;
    log?: (message: string, fields?: Record<string, unknown>) => void;
  }) {
    this.db = deps.db;
    this.chain = deps.chain;
    this.metrics = deps.metrics;
    this.log = deps.log ?? (() => undefined);
  }

  private write(
    kind: AccountKind,
    address: string,
    slot: bigint,
    data: Uint8Array,
  ): Promise<boolean> {
    const decoded = jsonSafe(decodeAccount(kind, data)) as JsonRecord;
    return upsertAccount(this.db, kind, address, slot, decoded);
  }

  /**
   * Full account sync: read every program account at one slot, upsert it, and delete rows for accounts that no
   * longer exist on chain. This is both the backfill after a long outage and the periodic chain-account
   * reconciliation, so the DB can never keep an account the chain has dropped.
   */
  async syncAccounts(): Promise<SyncReport> {
    const { slot, accounts } = await this.chain.getProgramAccounts();
    let upserted = 0;
    let stale = 0;
    let undecodable = 0;
    const live = new Map<AccountKind, Set<string>>();
    for (const a of accounts) {
      const kind = accountKind(a.data);
      if (!isKind(kind)) {
        undecodable += 1;
        continue;
      }
      try {
        if (await this.write(kind, a.address, slot, a.data)) upserted += 1;
        else stale += 1;
        const set = live.get(kind) ?? new Set<string>();
        set.add(a.address);
        live.set(kind, set);
      } catch (error) {
        undecodable += 1;
        this.log("undecodable account", { address: a.address, kind, error: String(error) });
      }
    }
    let removed = 0;
    for (const kind of ACCOUNT_KINDS) {
      const keep = [...(live.get(kind) ?? [])];
      const result = await this.db.query(
        `DELETE FROM ${TABLE[kind]} WHERE slot <= $1 AND NOT (address = ANY($2::text[]))`,
        [slot.toString(), keep],
      );
      removed += result.rowCount;
    }
    return { slot, upserted, stale, removed, undecodable };
  }

  /** Re-read specific accounts and write (or delete) them. */
  async refreshAccounts(addresses: readonly string[]): Promise<void> {
    if (addresses.length === 0) return;
    const { slot, accounts } = await this.chain.getAccounts(addresses);
    for (const [i, address] of addresses.entries()) {
      const account = accounts[i];
      if (!account) {
        // Only a definitive absence removes a row; a row read at a later slot is left alone.
        for (const kind of ACCOUNT_KINDS)
          await this.db.query(`DELETE FROM ${TABLE[kind]} WHERE address = $1 AND slot <= $2`, [
            address,
            slot.toString(),
          ]);
        continue;
      }
      const kind = accountKind(account.data);
      if (isKind(kind)) await this.write(kind, address, slot, account.data);
    }
  }

  /** Addresses an event tells us to re-read. Events are hints; the accounts are the truth. */
  private touched(name: string, data: JsonRecord): string[] {
    const out = new Set<string>();
    for (const field of [
      "mandate",
      "bid",
      "attestation",
      "position_set",
      "positionSet",
      "market",
      "observerSet",
      "observer_set",
    ]) {
      const v = data[field];
      if (typeof v === "string") out.add(v);
    }
    if (
      name === "EpochFinalized" &&
      typeof data["mandate"] === "string" &&
      typeof data["epochIndex"] === "number"
    )
      out.add(findEpochResultPda(new PublicKey(data["mandate"]), data["epochIndex"]).toBase58());
    return [...out];
  }

  /** Record one transaction's events (idempotent) and refresh what they touched. Returns events recorded. */
  async processSignature(
    signature: string,
    slot: bigint,
    blockTime: number | null,
  ): Promise<number> {
    const tx = await this.chain.getTransactionLogs(signature);
    if (!tx) throw new Error(`transaction ${signature} not available yet`);
    const events = parseProgramEvents(tx.logs);
    const touched = new Set<string>();
    let recorded = 0;
    for (const [i, e] of events.entries()) {
      const mandate = typeof e.data["mandate"] === "string" ? e.data["mandate"] : null;
      if (
        await insertEvent(this.db, {
          signature,
          eventIndex: i,
          slot,
          blockTime,
          name: e.name,
          mandate,
          data: e.data,
        })
      ) {
        recorded += 1;
        this.metrics?.indexerEvents.inc({ name: e.name });
      }
      for (const a of this.touched(e.name, e.data)) touched.add(a);
    }
    await this.refreshAccounts([...touched]);
    return recorded;
  }

  /**
   * Catch up on transactions since the durable cursor. Signatures are fetched newest-first in pages, then
   * processed oldest-first, and the cursor only advances past a signature once it is fully processed. A crash or
   * disconnect therefore repeats work (harmless: everything is idempotent) and never skips a signature.
   */
  async backfillEvents(options: { pageSize?: number } = {}): Promise<{ processed: number }> {
    const pageSize = options.pageSize ?? 100;
    const cursor = await getCursor(this.db, CURSOR_NAME);
    const pending: { signature: string; slot: bigint; blockTime: number | null }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.chain.getSignatures({
        limit: pageSize,
        ...(cursor.lastSignature ? { until: cursor.lastSignature } : {}),
        ...(before ? { before } : {}),
      });
      for (const s of page) if (!s.failed) pending.push(s);
      const last = page.at(-1);
      if (page.length < pageSize || !last) break;
      before = last.signature;
    }
    let processed = 0;
    for (const s of pending.reverse()) {
      await this.processSignature(s.signature, s.slot, s.blockTime);
      await setCursor(this.db, CURSOR_NAME, { lastSignature: s.signature, lastSlot: s.slot });
      processed += 1;
    }
    return { processed };
  }

  /** One full pass: accounts first (authoritative), then events since the cursor. */
  async syncOnce(): Promise<{ accounts: SyncReport; events: number }> {
    const accounts = await this.syncAccounts();
    const { processed } = await this.backfillEvents();
    const head = await this.chain.getSlot();
    this.metrics?.indexerSlotLag.set(Number(head > accounts.slot ? head - accounts.slot : 0n));
    this.metrics?.indexerLastSyncTimestamp.set(Date.now() / 1000);
    return { accounts, events: processed };
  }

  /** Destructive rebuild from chain only: drop all derived state, then re-derive it. Queue data is kept. */
  async rebuild(): Promise<{ accounts: SyncReport; events: number }> {
    await this.db.transaction((tx) => truncateDerived(tx));
    return this.syncOnce();
  }

  /**
   * Compare every mandate's counters, its epoch results and its real vault balance (docs/adr/0017). A mismatch is
   * stored, exported as a metric, and returned so the caller can alert loudly.
   */
  async reconcileVaults(now = new Date()): Promise<{ checked: number; failing: string[] }> {
    const mandates = await this.db.query<{ address: string; data: MandateAccount }>(
      "SELECT address, data FROM mandates",
    );
    const failing: string[] = [];
    let worst = 0n;
    for (const row of mandates.rows) {
      const m = toMandate(row.data);
      const vault = String((row.data as unknown as Record<string, unknown>)["vault"]);
      const balance = await this.chain.getTokenBalance(vault);
      const results = await this.db.query<{ data: EpochResultAccount }>(
        "SELECT data FROM epoch_results WHERE mandate = $1",
        [row.address],
      );
      const report = reconcileMandate({
        mandate: m,
        vaultBalanceRaw: balance ? balance.amount : null,
        results: results.rows.map((r) => toResult(r.data)),
      });
      const actual = balance?.amount ?? null;
      const diff =
        actual === null
          ? 0n
          : actual > report.ledger.expectedVaultRaw
            ? actual - report.ledger.expectedVaultRaw
            : report.ledger.expectedVaultRaw - actual;
      if (diff > worst) worst = diff;
      if (!report.ok) failing.push(row.address);
      await saveReconciliation(this.db, {
        mandate: row.address,
        checkedAt: now,
        slot: balance?.slot ?? 0n,
        ok: report.ok,
        expectedRaw: report.ledger.expectedVaultRaw,
        actualRaw: actual,
        findings: jsonSafe(report.findings),
      });
    }
    this.metrics?.vaultReconciliationFailures.set(failing.length);
    this.metrics?.vaultReconciliationErrorRaw.set(Number(worst));
    if (failing.length > 0) this.log("VAULT RECONCILIATION MISMATCH", { mandates: failing });
    return { checked: mandates.rows.length, failing };
  }

  async removeAccount(kind: AccountKind, address: string): Promise<void> {
    await deleteAccount(this.db, kind, address);
  }
}

/** Stored JSON (u64 as strings, keys as base58) back to the typed shape the reconciler expects. */
function toMandate(d: MandateAccount): MandateAccount {
  const r = d as unknown as Record<string, string | number>;
  const big = (k: string): bigint => BigInt(String(r[k]));
  return {
    ...d,
    maxRewardRaw: big("maxRewardRaw"),
    acceptedRewardRaw: big("acceptedRewardRaw"),
    earnedRewardRaw: big("earnedRewardRaw"),
    forfeitedRewardRaw: big("forfeitedRewardRaw"),
    claimedRewardRaw: big("claimedRewardRaw"),
    sponsorWithdrawnRaw: big("sponsorWithdrawnRaw"),
  };
}

function toResult(d: EpochResultAccount): EpochResultAccount {
  const r = d as unknown as Record<string, string | number>;
  return {
    ...d,
    rewardEarnedRaw: BigInt(String(r["rewardEarnedRaw"])),
    rewardForfeitedRaw: BigInt(String(r["rewardForfeitedRaw"])),
  };
}
