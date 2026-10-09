// Autopilot stored its posts 2 hours late for Africa/Kigali (09:00 and 18:00 were saved as UTC; reported to the lead as a
// possible time-zone issue). Moves them back to the configured local posting times so the demo screens match the settings.
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS.nova.email]);
const r = await q(`update "Post" set "scheduledAt" = "scheduledAt" - interval '2 hours' where "businessId" = $1 and source = 'AUTOPILOT' and status = 'PENDING_APPROVAL'
  and extract(hour from "scheduledAt") in (9, 18) returning "scheduledAt"::text`, [biz.id]);
console.log(r.length, r.slice(0, 2));
await pool.end();
