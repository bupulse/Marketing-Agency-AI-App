// Screenshots of the signed-in app for each demo business.
// Usage: node capture-app.mjs inzu|urugo|nova [desktop|mobile]
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { go, launch, login, newContext, settle, shot } from "./lib.mjs";

const slug = process.argv[2];
const which = process.argv[3] ?? "desktop";
const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS[slug].email]);
const projectId = async (title) => (await q(`select id from "Project" where "businessId" = $1 and title = $2`, [biz.id, title]))[0].id;

const browser = await launch();
const mobile = which === "mobile";
const ctx = await newContext(browser, { mobile });
const page = await login(ctx, slug);
const m = { mobile };
const full = { mobile, fullPage: true };
const top = () => page.evaluate(() => window.scrollTo(0, 0));
async function scrollTo(locator, offset = 90) {
  await locator.first().scrollIntoViewIfNeeded();
  await page.evaluate((o) => window.scrollBy(0, -o), offset);
  await settle(page, 400);
}
// The trial/plan banner can be dismissed; dismiss nothing so the real UI is kept.

async function contentTabs(prefix, opts = m) {
  const tabs = page.getByRole("tablist").first();
  await scrollTo(tabs, 150);
  await shot(page, slug, `${prefix}`, opts);
  for (const [tab, name] of [["Video script", "video-script"], ["Ad headlines", "ad-headlines"]]) {
    await tabs.getByRole("tab", { name: tab }).click();
    await settle(page, 400);
    await shot(page, slug, `${prefix}-${name}`, opts);
  }
  await tabs.getByRole("tab", { name: /Caption/ }).click();
}

async function dashboard() {
  await go(page, "/dashboard", 1200);
  await shot(page, slug, "dashboard", m);
  if (!mobile) await shot(page, slug, "dashboard", full);
}

if (slug === "inzu") {
  await dashboard();
  const dress = await projectId("Kitenge summer dress");
  await go(page, `/dashboard/projects/${dress}`, 1200);
  // The latest version is the English one; then the Kinyarwanda version from the history.
  await contentTabs("content-result");
  const other = page.locator('button[aria-label^="View version from"]:not([disabled])');
  await scrollTo(page.getByRole("heading", { name: "Version history" }), 120);
  if (!mobile) await shot(page, slug, "version-history");
  await other.first().click();
  await settle(page, 800);
  await contentTabs("content-result-rw");
  await page.getByRole("button", { name: "Back to latest" }).click().catch(() => {});
  if (!mobile) {
    await top();
    await shot(page, slug, "project", full);
    await scrollTo(page.getByRole("heading", { name: "Versions for each network" }));
    await shot(page, slug, "network-versions");
    await go(page, "/dashboard/projects");
    await shot(page, slug, "projects");
    await go(page, "/dashboard/gallery", 1500);
    await shot(page, slug, "gallery");
    const folder = (await q(`select id from "MediaFolder" where "businessId" = $1 and name = 'Dresses'`, [biz.id]))[0].id;
    await go(page, `/dashboard/gallery?folder=${folder}`, 1500);
    await shot(page, slug, "gallery-dresses");
    await go(page, "/dashboard/designs", 1500);
    await scrollTo(page.getByRole("heading", { name: "Your designs" }));
    await shot(page, slug, "designs");
    await go(page, "/dashboard/calendar", 1500);
    await shot(page, slug, "calendar");
    await page.getByRole("button", { name: /Kitenge|kitenge|Step out/ }).first().click().catch(() => {});
    await settle(page, 1000);
    await shot(page, slug, "calendar-post");
    await go(page, "/dashboard/usage", 1000);
    await shot(page, slug, "usage");
    await go(page, "/dashboard/billing", 1000);
    await shot(page, slug, "billing");
    await shot(page, slug, "billing", full);
    await go(page, "/dashboard/content", 1000);
    await shot(page, slug, "content-library");
    await go(page, "/dashboard/brand", 1000);
    await shot(page, slug, "brand");
  } else {
    await go(page, "/dashboard/calendar", 1500);
    await shot(page, slug, "calendar", m);
  }
}

if (slug === "urugo") {
  await dashboard();
  const house = await projectId("3-bedroom house, Kibagabaga");
  if (!mobile) {
    await go(page, "/dashboard/projects", 1500);
    await shot(page, slug, "projects");
  }
  await go(page, `/dashboard/projects/${house}`, 1200);
  await shot(page, slug, "project", m);
  await contentTabs("content-result");
  if (!mobile) {
    await scrollTo(page.getByRole("heading", { name: "Your designs" }));
    await shot(page, slug, "project-designs");
    // Composer with per-network previews, opened from "Schedule" on the listing's content.
    await top();
    await page.getByRole("button", { name: "Schedule", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 60_000 });
    await settle(page, 1500);
    await shot(page, slug, "composer");
    const tabs = dialog.getByRole("tablist", { name: "Edit for each network" });
    if (await tabs.count()) {
      for (const t of ["Instagram", "Facebook"]) {
        const tab = tabs.getByRole("tab", { name: new RegExp(t) });
        if (await tab.count()) { await tab.click(); await settle(page, 600); await shot(page, slug, `composer-${t.toLowerCase()}`); }
      }
    }
    const previews = dialog.getByRole("complementary", { name: "Previews" });
    if (await previews.count()) {
      await previews.scrollIntoViewIfNeeded();
      await settle(page, 500);
      await shot(page, slug, "composer-previews");
    }
    await page.keyboard.press("Escape");
    await go(page, "/dashboard/calendar", 1500);
    await shot(page, slug, "calendar");
    await shot(page, slug, "calendar", full);
    const published = page.locator("section[aria-label^='Monday'] button").filter({ hasText: /./ }).nth(1);
    await published.click().catch(() => {});
    await settle(page, 1000);
    await shot(page, slug, "calendar-post-published");
    await page.keyboard.press("Escape");
    await go(page, "/dashboard/connections", 1200);
    await shot(page, slug, "channels");
    await go(page, "/dashboard/settings/team", 1200);
    await shot(page, slug, "team");
    await go(page, "/dashboard/designs", 1500);
    await scrollTo(page.getByRole("heading", { name: "Your designs" }));
    await shot(page, slug, "designs");
    await go(page, "/dashboard/gallery", 1500);
    await shot(page, slug, "gallery");
    await go(page, "/dashboard/leads", 1200);
    await shot(page, slug, "leads");
    await go(page, "/dashboard/billing", 1000);
    await shot(page, slug, "billing");
    await go(page, "/dashboard/usage", 1000);
    await shot(page, slug, "usage");
  } else {
    await go(page, "/dashboard/calendar", 1500);
    await shot(page, slug, "calendar", m);
  }
}

if (slug === "nova") {
  await dashboard();
  await go(page, "/dashboard/autopilot", 1500);
  await shot(page, slug, "autopilot", m);
  if (!mobile) await shot(page, slug, "autopilot", full);
  await go(page, "/dashboard/leads", 1200);
  await shot(page, slug, "leads", m);
  const newest = (await q(`select id, name from "Lead" where "businessId" = $1 order by "createdAt" desc limit 2`, [biz.id]));
  const divine = newest.find((l) => l.name === "Divine Mukamana") ?? newest[0];
  await page.getByRole("button", { name: new RegExp(divine.name) }).first().click();
  await settle(page, 1200);
  await shot(page, slug, "lead-detail", m);
  if (!mobile) {
    await go(page, "/dashboard/analytics", 2000);
    await shot(page, slug, "analytics");
    await shot(page, slug, "analytics", full);
    await go(page, "/dashboard/gallery", 1500);
    await shot(page, slug, "gallery");
    await go(page, "/dashboard/designs", 1500);
    await scrollTo(page.getByRole("heading", { name: "Your designs" }));
    await shot(page, slug, "designs");
    await go(page, "/dashboard/connectors", 1200);
    await shot(page, slug, "connectors");
    await shot(page, slug, "connectors", full);
    await go(page, "/dashboard/brand", 1200);
    await shot(page, slug, "brand");
    await shot(page, slug, "brand", full);
    await go(page, "/dashboard/widget", 1500);
    await shot(page, slug, "widget-settings");
    await shot(page, slug, "widget-settings", full);
    await go(page, "/dashboard/calendar", 1500);
    await page.getByRole("button", { name: "Next week" }).click();
    await settle(page, 1200);
    await shot(page, slug, "calendar-next-week");
    await go(page, "/dashboard/connections", 1200);
    await shot(page, slug, "channels");
    await go(page, "/dashboard/projects", 1200);
    await shot(page, slug, "projects");
    await go(page, `/dashboard/projects/${await projectId("Samsung Galaxy A56")}`, 1200);
    await contentTabs("content-result");
    await go(page, "/dashboard/billing", 1000);
    await shot(page, slug, "billing");
  }
}
await browser.close();
await pool.end();
