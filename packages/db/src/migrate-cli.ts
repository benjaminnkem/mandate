/** Apply pending migrations: `DATABASE_URL=postgresql://... pnpm db:migrate`. */
import { createPgDb } from "./db.ts";
import { migrate } from "./migrate.ts";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const db = createPgDb(url, { max: 1 });
try {
  const applied = await migrate(db);
  console.log(applied.length === 0 ? "database is up to date" : `applied: ${applied.join(", ")}`);
} finally {
  await db.close();
}
