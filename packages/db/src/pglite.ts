/* The row type parameter is the caller's stated expectation of a query's result shape. */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
import { PGlite } from "@electric-sql/pglite";

import type { Db, Queryable } from "./db.ts";

/**
 * A real PostgreSQL engine running in-process (PGlite). Used by tests and load tests so they need no external
 * service; production always uses `createPgDb`. It is not a mock of the SQL: the same migrations and queries run.
 */
export async function createPgliteDb(): Promise<Db> {
  const lite = await PGlite.create({
    parsers: { 20: (v: string) => v, 1700: (v: string) => v },
  });
  const wrap = (client: PGlite | Pick<PGlite, "query" | "exec">): Queryable => ({
    async exec(sql: string) {
      await client.exec(sql);
    },
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const result = await client.query<T>(sql, params as unknown[]);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  });
  return {
    ...wrap(lite),
    async transaction<T>(work: (tx: Queryable) => Promise<T>) {
      return lite.transaction((tx) => work(wrap(tx)));
    },
    async close() {
      await lite.close();
    },
  };
}
