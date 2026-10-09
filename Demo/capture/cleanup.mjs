// Deletes EXACTLY the demo accounts created for the videos (the demo+... emails in accounts.mjs) and everything under them:
// Storage files (brand, media, designs buckets under <userId>/), loose rows keyed by user/business id without a foreign key
// (AiCall, AnalyticsEvent, ErrorLog, RateLimit), the User rows (cascade: Business, projects, posts, leads, chats, designs,
// gallery, connections, team, usage, subscription ...) and the Supabase auth users.
// Dry run by default. Usage: node cleanup.mjs          (shows what would be deleted)
//                            node cleanup.mjs --yes    (deletes)
import { createClient } from "@supabase/supabase-js";
import { pool, q } from "./db.mjs";
import { ALL_DEMO_EMAILS } from "./accounts.mjs";

const yes = process.argv.includes("--yes");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const BUCKETS = ["brand", "media", "designs"];

async function listAll(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    for (const item of data) {
      const p = `${prefix}/${item.name}`;
      if (item.id) out.push(p);
      else out.push(...(await listAll(bucket, p)));
    }
    if (data.length < 100) return out;
  }
}

// Only exact matches of the known demo addresses, checked again in SQL.
const users = await q(`select id, email from auth.users where email = any($1::text[]) and email like 'demo+%@bupulse.com'`, [ALL_DEMO_EMAILS]);
const businesses = await q(`select id, name, "userId" from "Business" where "userId" = any($1::uuid[])`, [users.map((u) => u.id)]);
console.log("Demo users:", users.map((u) => u.email));
console.log("Demo businesses:", businesses.map((b) => b.name));
const userIds = users.map((u) => u.id);
const bizIds = businesses.map((b) => b.id);

for (const u of users) {
  for (const bucket of BUCKETS) {
    const paths = await listAll(bucket, u.id);
    console.log(`  ${u.email}: ${paths.length} file(s) in ${bucket}`);
    if (yes) for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
  }
}

if (!yes) {
  console.log("\nDry run. Run with --yes to delete.");
} else {
  await q(`delete from "AiCall" where "userId" = any($1::uuid[]) or "businessId" = any($2::text[])`, [userIds, bizIds]);
  await q(`delete from "AnalyticsEvent" where "userId" = any($1::uuid[]) or "businessId" = any($2::text[])`, [userIds, bizIds]);
  await q(`delete from "ErrorLog" where "userId" = any($1::text[]) or "businessId" = any($2::text[])`, [userIds, bizIds]);
  await q(`delete from "RateLimit" where ${userIds.map((_, i) => `key like '%' || $${i + 1} || '%'`).join(" or ") || "false"}`, userIds);
  await q(`delete from "User" where id = any($1::uuid[])`, [userIds]);
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) console.error("auth delete failed", u.email, error.message);
    else console.log("deleted", u.email);
  }
}
await pool.end();
