// Migration runner for GSTPilot. Run with: pnpm migrate
// A migration is a numbered SQL file that changes the database's shape (new tables, new
// extensions). This script applies every file in supabase/migrations/ in order, exactly once,
// remembering what it has already run in a gstpilot_migrations bookkeeping table — so running
// it twice is always safe, and a teammate (or Render) can recreate the database from scratch.

import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing in .env (direct Postgres connection string).");

  // Supabase's hosted Postgres requires an encrypted connection; rejectUnauthorized:false
  // accepts its certificate without a local CA bundle — fine for a dev script.
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Bookkeeping table: one row per migration we've already applied.
    // Prefixed gstpilot_ because this database is shared with another project for now.
    await client.query(`
      create table if not exists gstpilot_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Set(
      (await client.query("select name from gstpilot_migrations")).rows.map((r) => r.name)
    );

    // Filenames start with a number (0001_, 0002_ …) so alphabetical order = correct order.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`· ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      // Transaction: the migration and its bookkeeping row succeed or fail together,
      // so a crash can never leave the database half-migrated but marked done.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into gstpilot_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`✓ ${file} applied`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${file} failed: ${(e as Error).message}`);
      }
    }
    console.log("Database is up to date.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
