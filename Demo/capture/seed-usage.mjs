// Sets this month's usage meters to believable mid-month numbers (the real counters only show the few demo generations).
import crypto from "node:crypto";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
const USAGE = { inzu: [12, 4, 0], urugo: [38, 21, 0], nova: [64, 33, 412] };
for (const [slug, [text, image, chat]] of Object.entries(USAGE)) {
  const [u] = await q(`select u.id, s."currentPeriodStart" p from "User" u join "Subscription" s on s."userId" = u.id where u.email = $1`, [ACCOUNTS[slug].email]);
  await q(`insert into "UsageRecord"(id, "userId", "periodStart", "textGenerations", "imageGenerations", "chatMessages", "updatedAt") values ($1,$2,$3,$4,$5,$6,now())
           on conflict ("userId", "periodStart") do update set "textGenerations" = $4, "imageGenerations" = $5, "chatMessages" = $6, "updatedAt" = now()`,
    ["demo" + crypto.randomBytes(10).toString("hex"), u.id, u.p, text, image, chat]);
}
console.log(await q(`select u.email, r."periodStart", r."textGenerations", r."imageGenerations", r."chatMessages" from "UsageRecord" r join "User" u on u.id = r."userId" where u.email like 'demo+%'`));
await pool.end();
