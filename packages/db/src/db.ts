/* The row type parameter is the caller's stated expectation of a query's result shape. */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
import pg from "pg";

export interface QueryResult<T> {
  readonly rows: T[];
  readonly rowCount: number;
}

export interface Queryable extends Executable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

/** Run several statements with no parameters (schema scripts). */
export interface Executable {
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Run `work` in one transaction: commit if it resolves, roll back if it throws. */
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// int8 and numeric are returned as decimal strings by BOTH drivers. Amounts are u64 and must never pass
// through a JavaScript number.
const INT8 = 20;
const NUMERIC = 1700;

/** Production driver: a `pg` connection pool. */
export function createPgDb(connectionString: string, options: { max?: number } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        oid === INT8 || oid === NUMERIC
          ? (value: string) => value
          : (pg.types.getTypeParser(oid, format) as (value: string) => unknown)) as never,
    },
  });
  const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async exec(sql: string) {
      await client.query(sql);
    },
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const result = await client.query(sql, params as unknown[]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
  });
  return {
    ...wrap(pool),
    async transaction<T>(work: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await work(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
