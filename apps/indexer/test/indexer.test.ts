import { createTestDb } from "@mandate/db/testing";
import { migrate, type Db } from "@mandate/db";
import { createMetrics } from "@mandate/observability";
import { findMandatePda, findEpochResultPda } from "@mandate/solana";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Indexer } from "../src/indexer.ts";
import {
  MemoryChain,
  bn,
  claimedEvent,
  encodeAccount,
  key,
  mandateFields,
  programLog,
} from "./support.ts";

let db: Db;
let chain: MemoryChain;
let indexer: Indexer;
const alerts: string[] = [];
const metrics = createMetrics("indexer-test");

beforeEach(async () => {
  db = await createTestDb();
  await migrate(db);
  chain = new MemoryChain();
  alerts.length = 0;
  indexer = new Indexer({ db, chain, metrics, log: (m) => alerts.push(m) });
});
afterEach(async () => {
  await db.close();
});

const M = findMandatePda(key(1), 1n);
const count = async (table: string): Promise<number> =>
  Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]?.n);

async function seed(): Promise<void> {
  chain.set(M, await encodeAccount("Mandate", mandateFields()));
  chain.set(
    key(20),
    await encodeAccount("Bid", {
      mandate: M,
      provider: key(9),
      requested_reward_raw: bn(100),
      status: { Active: {} },
    }),
  );
  chain.set(
    key(21),
    await encodeAccount("PositionSet", { mandate: M, provider: key(9), position_count: 1 }),
  );
  chain.set(
    findEpochResultPda(M, 0),
    await encodeAccount("EpochResult", {
      mandate: M,
      epoch_index: 0,
      outcome: { Compliant: {} },
      reward_earned_raw: bn(33),
      evidence_hash: Array.from({ length: 32 }, () => 7),
    }),
  );
  chain.tokens.set(String(new Map([[0, 0]]).size), 0n);
}

describe("account sync", () => {
  it("indexes every program account with exact amounts, and is idempotent", async () => {
    await seed();
    const first = await indexer.syncAccounts();
    expect(first).toMatchObject({ upserted: 4, undecodable: 0, removed: 0 });
    const again = await indexer.syncAccounts();
    expect(again.undecodable).toBe(0);
    expect([
      await count("mandates"),
      await count("bids"),
      await count("position_sets"),
      await count("epoch_results"),
    ]).toEqual([1, 1, 1, 1]);
    const { rows } = await db.query<{
      max_reward_raw: string;
      provider: string;
      status: string;
      data: { startAt: string };
    }>("SELECT max_reward_raw, provider, status, data FROM mandates");
    expect(rows[0]).toMatchObject({
      max_reward_raw: "130",
      status: "Active",
      data: { startAt: "1000000" },
    });
    const result = await db.query<{ evidence_hash: string }>(
      "SELECT evidence_hash FROM epoch_results",
    );
    expect(result.rows[0]?.evidence_hash).toBe("07".repeat(32));
  });

  it("counts, rather than crashes on, accounts it cannot decode", async () => {
    await seed();
    chain.set(key(50), new Uint8Array(40));
    const r = await indexer.syncAccounts();
    expect(r.undecodable).toBe(1);
    expect(await count("mandates")).toBe(1);
  });

  it("never lets an older read overwrite newer state", async () => {
    await seed();
    await indexer.syncAccounts();
    chain.slot += 10n;
    chain.set(M, await encodeAccount("Mandate", mandateFields({ finalized_epochs: 2 })));
    await indexer.syncAccounts();
    // A delayed reader that saw the chain at an older slot arrives late.
    const stale = new Indexer({
      db,
      chain: Object.assign(Object.create(chain) as MemoryChain, { slot: 100n }),
    });
    chain.set(M, await encodeAccount("Mandate", mandateFields({ finalized_epochs: 1 })));
    const r = await stale.syncAccounts();
    expect(r.stale).toBeGreaterThan(0);
    const { rows } = await db.query<{ finalized_epochs: number }>(
      "SELECT finalized_epochs FROM mandates",
    );
    expect(rows[0]?.finalized_epochs).toBe(2);
  });

  it("removes rows for accounts the chain no longer has", async () => {
    await seed();
    await indexer.syncAccounts();
    chain.accounts.delete(key(20).toBase58());
    chain.slot += 1n;
    const r = await indexer.syncAccounts();
    expect(r.removed).toBe(1);
    expect(await count("bids")).toBe(0);
  });
});

describe("event backfill", () => {
  it("records events once, moves the durable cursor, and only fetches what is new", async () => {
    await seed();
    chain.addTx("sigA", programLog(claimedEvent(M, key(9), 20n, 20n, 110n)));
    chain.addTx("sigB", programLog(claimedEvent(M, key(9), 5n, 25n, 105n)));
    expect(await indexer.backfillEvents({ pageSize: 1 })).toEqual({ processed: 2 });
    expect(await count("indexed_events")).toBe(2);
    const claims = await db.query<{ amount_raw: string }>(
      "SELECT amount_raw FROM reward_claims ORDER BY slot",
    );
    expect(claims.rows.map((r) => r.amount_raw)).toEqual(["20", "5"]);
    expect(await indexer.backfillEvents()).toEqual({ processed: 0 });
    chain.addTx("sigC", programLog(claimedEvent(M, key(9), 1n, 26n, 104n)));
    expect(await indexer.backfillEvents()).toEqual({ processed: 1 });
    expect(await count("reward_claims")).toBe(3);
  });

  it("resumes after an interruption without skipping or duplicating anything", async () => {
    await seed();
    for (const s of ["s1", "s2", "s3"])
      chain.addTx(s, programLog(claimedEvent(M, key(9), 1n, 1n, 1n)));
    chain.failLogsFor.add("s2");
    await expect(indexer.backfillEvents()).rejects.toThrow(/rpc unavailable/);
    expect(await count("indexed_events")).toBe(1);
    chain.failLogsFor.clear();
    expect(await indexer.backfillEvents()).toEqual({ processed: 2 });
    expect(await count("indexed_events")).toBe(3);
    expect(
      (await db.query<{ last_signature: string }>("SELECT last_signature FROM chain_cursor"))
        .rows[0]?.last_signature,
    ).toBe("s3");
  });

  it("ignores failed transactions", async () => {
    await seed();
    chain.addTx("bad", programLog(claimedEvent(M, key(9), 1n, 1n, 1n)), true);
    expect(await indexer.backfillEvents()).toEqual({ processed: 0 });
    expect(await count("indexed_events")).toBe(0);
  });

  it("takes balances from account state, never from event fields", async () => {
    await seed();
    // The event claims a huge total; the mandate account is what the read model must show.
    chain.addTx("lie", programLog(claimedEvent(M, key(9), 1n, 999_999n, 1n)));
    await indexer.syncOnce();
    const { rows } = await db.query<{ claimed_raw: string }>("SELECT claimed_raw FROM mandates");
    expect(rows[0]?.claimed_raw).toBe("0");
  });
});

describe("rebuild and reconciliation", () => {
  const snapshot = async (): Promise<unknown> => {
    const out: Record<string, unknown> = {};
    for (const t of [
      "mandates",
      "bids",
      "position_sets",
      "epoch_results",
      "reward_claims",
      "indexed_events",
    ])
      out[t] = (await db.query(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows;
    return out;
  };

  it("rebuilds the identical read model from the chain alone", async () => {
    await seed();
    chain.addTx("c1", programLog(claimedEvent(M, key(9), 20n, 20n, 110n)));
    await indexer.syncOnce();
    const before = await snapshot();
    await db.query("UPDATE mandates SET status = 'Closed', claimed_raw = 5"); // corrupt derived state
    await db.query("DELETE FROM epoch_results");
    await indexer.rebuild();
    expect(await snapshot()).toEqual(before);
  });

  it("keeps the job queue when rebuilding", async () => {
    await db.query(
      `INSERT INTO jobs (key, kind, payload, state, max_attempts, run_at, created_at, updated_at)
       VALUES ('finalize:x:0','finalize','{}','queued',3,now(),now(),now())`,
    );
    await seed();
    await indexer.rebuild();
    expect(await count("jobs")).toBe(1);
  });

  it("passes reconciliation when the vault matches, and alerts on a one-unit difference", async () => {
    await seed();
    // max 130, claimed 0, withdrawn 0 -> vault must hold exactly 130; epoch 0 earned 33 must match the mandate.
    chain.set(
      M,
      await encodeAccount(
        "Mandate",
        mandateFields({ finalized_epochs: 1, compliant_epochs: 1, earned_reward_raw: bn(33) }),
      ),
    );
    await indexer.syncAccounts();
    const vault = String(
      (await db.query<{ data: { vault: string } }>("SELECT data FROM mandates")).rows[0]?.data
        .vault,
    );
    chain.tokens.set(vault, 130n);
    expect(await indexer.reconcileVaults()).toEqual({ checked: 1, failing: [] });
    expect(
      (await db.query<{ ok: boolean }>("SELECT ok FROM vault_reconciliations")).rows[0]?.ok,
    ).toBe(true);

    chain.tokens.set(vault, 129n);
    const bad = await indexer.reconcileVaults();
    expect(bad.failing).toEqual([M.toBase58()]);
    expect(alerts).toContain("VAULT RECONCILIATION MISMATCH");
    const stored = await db.query<{ ok: boolean; expected_raw: string; actual_raw: string }>(
      "SELECT * FROM vault_reconciliations",
    );
    expect(stored.rows[0]).toMatchObject({ ok: false, expected_raw: "130", actual_raw: "129" });
    expect(
      await metrics.registry.getSingleMetricAsString("reward_vault_reconciliation_failures"),
    ).toContain(" 1");
  });
});
