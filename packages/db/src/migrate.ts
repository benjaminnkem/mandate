import { createHash } from "node:crypto";

import type { Db } from "./db.ts";
import { MIGRATIONS, type Migration } from "./migrations.ts";

const checksum = (m: Migration): string => createHash("sha256").update(m.sql).digest("hex");

/**
 * Apply pending migrations in order, each in its own transaction. Refuses to run if an already applied migration
 * has since been edited, so a database can never silently drift from the code that describes it.
 */
export async function migrate(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const applied = new Map(
    (
      await db.query<{ id: string; checksum: string }>("SELECT id, checksum FROM schema_migrations")
    ).rows.map((r) => [r.id, r.checksum]),
  );
  const ran: string[] = [];
  for (const m of migrations) {
    const known = applied.get(m.id);
    if (known !== undefined) {
      if (known !== checksum(m))
        throw new Error(
          `migration ${m.id} was modified after it was applied; add a new migration instead`,
        );
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [
        m.id,
        checksum(m),
      ]);
    });
    ran.push(m.id);
  }
  return ran;
}
