import { afterEach, describe, expect, it } from "vitest";

import { migrate, MIGRATIONS, type Db } from "../src/index.ts";
import { createTestDb } from "../src/testing.ts";

let db: Db | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe("migrations", () => {
  it("apply once, are idempotent, and refuse an edited migration", async () => {
    db = await createTestDb();
    expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await migrate(db)).toEqual([]);
    const edited = [{ id: MIGRATIONS[0]?.id ?? "", sql: "SELECT 1" }];
    await expect(migrate(db, edited)).rejects.toThrow(/modified after it was applied/);
  });

  it("returns u64-sized numbers exactly, as strings", async () => {
    db = await createTestDb();
    await migrate(db);
    await db.query(
      `INSERT INTO reward_claims (signature, event_index, mandate, provider, amount_raw, slot)
       VALUES ('s', 0, 'm', 'p', 18446744073709551615, 9007199254740993)`,
    );
    const { rows } = await db.query<{ amount_raw: string; slot: string }>(
      "SELECT amount_raw, slot FROM reward_claims",
    );
    expect(rows[0]).toEqual({ amount_raw: "18446744073709551615", slot: "9007199254740993" });
  });
});
