import { migrate, type Db } from "@mandate/db";
import { createTestDb } from "@mandate/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SYNTHETIC_LABEL, seedSynthetic, syntheticKey } from "../src/index.ts";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

describe("synthetic fixtures", () => {
  it("are deterministic and clearly labelled as synthetic", async () => {
    expect(syntheticKey("mandate", 1)).toBe(syntheticKey("mandate", 1));
    expect(syntheticKey("mandate", 1)).not.toBe(syntheticKey("mandate", 2));
    await seedSynthetic(db, {
      mandates: 20,
      epochsEach: 6,
      nowUnix: 2_000_000,
      startOffsetSeconds: 1200,
    });
    const labelled = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM mandates WHERE data->>'synthetic' = $1`,
      [SYNTHETIC_LABEL],
    );
    expect(labelled.rows[0]?.n).toBe("20");
    const total = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM mandates");
    expect(total.rows[0]?.n).toBe("20");
  });
});
