import { randomBytes } from "node:crypto";

import pg from "pg";

import { createPgDb, type Db } from "./db.ts";
import { createPgliteDb } from "./pglite.ts";

/**
 * A fresh, empty database for one test. By default an in-process PostgreSQL (PGlite). If `TEST_DATABASE_URL`
 * points at a real server, a throwaway database is created there and dropped on `close()`, so the same suite can
 * exercise true multi-connection concurrency. Test use only.
 */
export async function createTestDb(): Promise<Db> {
  const admin = process.env["TEST_DATABASE_URL"];
  if (!admin) return createPgliteDb();
  const name = `mandate_test_${randomBytes(6).toString("hex")}`;
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const db = createPgDb(url.toString());
  return {
    ...db,
    async close() {
      await db.close();
      const dropper = new pg.Client({ connectionString: admin });
      await dropper.connect();
      await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await dropper.end();
    },
  };
}
