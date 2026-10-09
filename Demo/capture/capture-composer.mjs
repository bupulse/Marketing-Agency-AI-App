// Urugo Homes: the post composer with both accounts picked (per-network previews), and a published post's details.
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { go, launch, login, newContext, settle, shot } from "./lib.mjs";

const slug = "urugo";
const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS[slug].email]);
const [house] = await q(`select id from "Project" where "businessId" = $1 and title = '3-bedroom house, Kibagabaga'`, [biz.id]);
const browser = await launch();
const ctx = await newContext(browser);
const page = await login(ctx, slug);

await go(page, `/dashboard/projects/${house.id}`, 1200);
await page.getByRole("button", { name: "Schedule", exact: true }).first().click();
const dialog = page.getByRole("dialog");
await dialog.waitFor({ timeout: 60_000 });
await settle(page, 1000);
for (const name of [/^Instagram:/, /^Facebook:/]) await dialog.getByRole("button", { name }).first().click();
await settle(page, 1500);
await shot(page, slug, "composer");
const tabs = dialog.getByRole("tablist", { name: "Edit for each network" });
for (const t of ["Instagram", "Facebook"]) {
  const tab = tabs.getByRole("tab", { name: new RegExp(t) });
  if (await tab.count()) { await tab.click(); await settle(page, 800); await shot(page, slug, `composer-${t.toLowerCase()}`); }
}
const previews = dialog.getByRole("complementary", { name: "Previews" });
await previews.evaluate((el) => el.scrollIntoView({ block: "start" }));
await settle(page, 600);
await shot(page, slug, "composer-previews");
// Scroll the dialog body to show the posting-time options too.
await dialog.getByRole("group", { name: "When to post" }).scrollIntoViewIfNeeded().catch(() => {});
await settle(page, 400);
await shot(page, slug, "composer-when");
await page.keyboard.press("Escape");

await go(page, "/dashboard/calendar", 1500);
await page.locator("section[aria-label^='Monday']").getByRole("button").filter({ hasText: "Secure" }).first().click();
await settle(page, 1500);
await shot(page, slug, "calendar-post-published");
await browser.close();
await pool.end();
