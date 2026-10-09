// Nova Phones: switches Autopilot on (7 posts a week, approval needed, free templates and gallery photos only),
// then presses the real "Plan next week now" button so the app's own planner writes next week.
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { go, launch, login, newContext } from "./lib.mjs";

const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS.nova.email]);
const conns = (await q(`select id from "Connection" where "businessId" = $1 and kind = 'SOCIAL' order by provider desc`, [biz.id])).map((c) => c.id);
await q(
  `insert into "AutopilotSettings"("businessId", enabled, "autoPublish", "postsPerWeek", "connectionIds", "postingTimes", "useAiImages", "skipReligiousHolidays", "updatedAt")
   values ($1, true, false, 7, $2, array['09:00','13:00','18:00'], false, false, now())
   on conflict ("businessId") do update set enabled = true, "autoPublish" = false, "postsPerWeek" = 7, "connectionIds" = $2, "postingTimes" = array['09:00','13:00','18:00'], "useAiImages" = false, "updatedAt" = now()`,
  [biz.id, conns],
);
const browser = await launch();
const ctx = await newContext(browser);
const page = await login(ctx, "nova");
await go(page, "/dashboard/autopilot");
await page.getByRole("button", { name: /Plan next week now/ }).click();
for (let i = 0; i < 600; i++) {
  const [run] = await q(`select status, "postCount", error from "AutopilotRun" where "businessId" = $1 order by "createdAt" desc limit 1`, [biz.id]);
  if (run && run.status !== "RUNNING") { console.log(run); break; }
  await page.waitForTimeout(2000);
}
await browser.close();
await pool.end();
