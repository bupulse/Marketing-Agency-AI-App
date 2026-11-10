// A full data backup of the production database, before a deploy that changes it (the owner's rule: production only
// with a backup first). Run on the server PC from the repo folder:
//
//   node scripts/self-host/windows/server.mjs tool backup
//
// Writes every table in public, plus auth.users and auth.identities, as gzipped JSON lines ({ table, row }) to
// %USERPROFILE%\bupulse-prod\backups\bupulse-<time>.jsonl.gz (the same format as wipe-test-clients' backup). Reads only.
// Keep the file private: it holds personal data. Reading from Rwanda can take 20 minutes or more.
import pg from "pg";
import { createGzip } from "node:zlib";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

if (!/gknlsmvrzsyxinwmodtk/.test(process.env.DATABASE_URL || "")) {
  console.error("Not the production database, stopping.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await db.connect();
const q = async (sql) => (await db.query(sql)).rows;

const dir = join(homedir(), "bupulse-prod", "backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `bupulse-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl.gz`);
const gz = createGzip();
const out = createWriteStream(file);
gz.pipe(out);
const tables = [
  ...(await q(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => `public."${r.t}"`),
  "auth.users",
  "auth.identities",
];
const started = Date.now();
let rows = 0;
for (const [i, t] of tables.entries()) {
  const batch = await q(`SELECT * FROM ${t}`);
  for (const row of batch) {
    if (!gz.write(JSON.stringify({ table: t, row }) + "\n")) await once(gz, "drain");
  }
  rows += batch.length;
  console.log(`${String(i + 1).padStart(3)}/${tables.length} ${t}: ${batch.length} rows`);
}
gz.end();
await once(out, "finish");
await db.end();
const mb = (statSync(file).size / 1048576).toFixed(1);
console.log(`\nBACKUP DONE: ${file} (${tables.length} tables, ${rows} rows, ${mb} MB, ${Math.round((Date.now() - started) / 1000)} s). Keep it private: it holds personal data.`);
