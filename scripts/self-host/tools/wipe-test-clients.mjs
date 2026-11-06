// Deletes every client account on bupulse.com except the admin console's logins (ADMIN_EMAILS) and staff
// (StaffMember), through the app's own account deletion (lib/account-deletion.ts, the 30-day purge), so Storage files,
// teammates, invoices, voice notes, payment proofs and the sign-ins go exactly as they do for a client who deletes
// their account. Owner, 6 November 2026: every client on production was a test account.
//
// Run on the PC through server.mjs (production settings in memory only):
//   node scripts/self-host/windows/server.mjs tool wipe-test-clients            preview: lists what would go, changes nothing
//   node scripts/self-host/windows/server.mjs tool wipe-test-clients --yes N    backup, then delete; N = the preview's count
//
// --yes: 1. writes a full backup of the database (every table in public, plus auth.users and auth.identities) to
// %USERPROFILE%\bupulse-prod\backups\ (gzipped JSON); 2. marks the N accounts due for deletion now and, for test
// subscriptions still marked paying, sets cancel-at-period-end (the purge refuses paying accounts); 3. asks the running
// server (127.0.0.1:3002) to run the purge, then prints what is left. App set-up (plans, prices, regions, industries,
// music, designs, settings, service keys) is not touched. The server must be running.
import pg from "pg";
import { createGzip } from "node:zlib";
import { createWriteStream, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const args = process.argv.slice(2);
const yesAt = args.indexOf("--yes");
const apply = yesAt >= 0;
const expected = apply ? Number(args[yesAt + 1]) : null;
if (apply && !Number.isInteger(expected)) {
  console.error("Usage: ... tool wipe-test-clients --yes <the number of accounts the preview listed>");
  process.exit(1);
}
if (!/gknlsmvrzsyxinwmodtk/.test(process.env.DATABASE_URL || "")) {
  console.error("Not the production database, stopping.");
  process.exit(1);
}
const admins = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
if (admins.length === 0) {
  console.error("ADMIN_EMAILS is empty: refusing to run (it would not know which login to keep).");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const staff = await q(`SELECT lower(email) AS email, "userId" FROM "StaffMember"`);
const staffEmails = new Set(staff.map((s) => s.email));
const users = await q(`
  SELECT u.id, lower(u.email) AS email, u."createdAt", b.name AS company,
         s.status::text AS sub_status, s."providerSubscriptionId" AS sub_id, s."cancelAtPeriodEnd" AS sub_cancel
  FROM "User" u
  LEFT JOIN "Business" b ON b."userId" = u.id
  LEFT JOIN "Subscription" s ON s."userId" = u.id
  ORDER BY u."createdAt"`);
const keep = users.filter((u) => admins.includes(u.email) || staffEmails.has(u.email) || staff.some((s) => s.userId === u.id));
const go = users.filter((u) => !keep.includes(u));
const paying = go.filter((u) => u.sub_id && !u.sub_cancel && (u.sub_status === "ACTIVE" || u.sub_status === "PAST_DUE"));
const orphans = await q(`SELECT count(*)::int AS n FROM auth.users a WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = a.id)`);

console.log(`\nKEPT (${keep.length}): admin console logins (ADMIN_EMAILS) and staff`);
for (const u of keep) console.log(`  keep  ${u.email}${u.company ? `  (${u.company})` : ""}`);
console.log(`  staff without a login yet: ${staff.filter((s) => !s.userId).length}`);
console.log(`\nTO DELETE (${go.length}): every other account, with its company and everything under it`);
for (const u of go) console.log(`  delete  ${u.email}  ${u.company ? `company "${u.company}"` : "(no company: teammate, creator or unfinished sign-up)"}  created ${u.createdAt.toISOString().slice(0, 10)}${paying.includes(u) ? "  [test subscription marked paying: will be set to cancel]" : ""}`);
console.log(`\nAlso: ${orphans[0].n} sign-in(s) with no account row; the purge's orphan sweep removes those older than its grace.`);
console.log("Not touched: plans, prices, regions, industries, music, designs, settings, service keys, quote requests, the audit log.");

if (!apply) {
  console.log(`\nPreview only: nothing was changed. To delete these ${go.length} account(s), run the same command with: --yes ${go.length}\n`);
  await db.end();
  process.exit(0);
}
if (expected !== go.length) {
  console.error(`\nThe preview now lists ${go.length} account(s), not ${expected}: stopping without changing anything. Run the preview again.`);
  await db.end();
  process.exit(1);
}

// 1. Backup: every table, written as gzipped JSON lines ({ table, row }).
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
let rows = 0;
for (const t of tables) {
  for (const row of await q(`SELECT * FROM ${t}`)) {
    if (!gz.write(JSON.stringify({ table: t, row }) + "\n")) await once(gz, "drain");
    rows += 1;
  }
}
gz.end();
await once(out, "finish");
console.log(`\n1/3 Backup written: ${file} (${tables.length} tables, ${rows} rows). Keep it private: it holds personal data.`);

// 2. Mark them due now (the purge's own rule), and unblock test subscriptions still marked paying.
const ids = go.map((u) => u.id);
if (paying.length) await q(`UPDATE "Subscription" SET "cancelAtPeriodEnd" = true WHERE "userId" = ANY($1::uuid[])`, [paying.map((u) => u.id)]);
await q(`UPDATE "User" SET "deletionScheduledFor" = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, [ids]);
console.log(`2/3 ${ids.length} account(s) marked for deletion now${paying.length ? `, ${paying.length} test subscription(s) set to cancel` : ""}.`);

// 3. The running server erases them (lib/account-deletion.ts), a few passes if needed.
const secret = process.env.CRON_SECRET;
for (let pass = 1; pass <= 5; pass++) {
  const res = await fetch("http://127.0.0.1:3002/api/cron/purge-accounts", { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.json().catch(() => ({}));
  console.log(`3/3 Purge pass ${pass}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  const left = (await q(`SELECT count(*)::int AS n FROM "User" WHERE id = ANY($1::uuid[])`, [ids]))[0].n;
  if (left === 0 || !res.ok) {
    console.log(left === 0 ? `\nDone: all ${ids.length} account(s) deleted. Kept: ${keep.map((u) => u.email).join(", ")}.\n` : `\nThe server refused the purge (is it running?). ${left} account(s) are still marked; they are erased by the nightly job.\n`);
    break;
  }
  if (pass === 5) console.log(`\n${left} account(s) are still there: see Admin -> Error log (source account-deletion). They stay marked and the nightly job retries.\n`);
}
await db.end();
