// Makes branded designs through the real Design studio on each project page, and captures the results.
// Usage: node designs.mjs inzu|urugo|nova
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { SCREENS, go, launch, login, newContext, settle, shot } from "./lib.mjs";

const D = {
  inzu: [
    { project: "Kitenge summer dress", template: "New arrival", photo: 2, headline: "Kitenge summer dress", subline: "Terracotta & gold · Sizes S to XXL", chip: "25,000 RWF", name: "design-new-arrival", capture: true, done: true },
    { project: "Kitenge summer dress", template: "New arrival", photo: 2, ratio: "Portrait", headline: "Kitenge summer dress", subline: "Terracotta & gold · Sizes S to XXL", chip: "25,000 RWF", name: "design-new-arrival-portrait" },
    { project: "Men's African print shirt", template: "New arrival", photo: 1, headline: "African print shirts", subline: "Smart for the office, perfect for gusaba", chip: "18,000 RWF", name: "design-shirt", done: true },
    { project: "Head wraps & beaded accessories", template: "Offer", photo: 1, headline: "Complete your look", subline: "Head wraps, beads and clutch bags", chip: "From 5,000", name: "design-accessories", done: true },
  ],
  urugo: [
    { project: "3-bedroom house, Kibagabaga", template: "Just listed", photo: 1, headline: "3-bedroom house, Kibagabaga", subline: "3 bed · 2 bath · garden · 450 m²", chip: "120,000,000 RWF", name: "design-just-listed", capture: true, done: true },
    { project: "3-bedroom house, Kibagabaga", template: "Just listed", photo: 1, ratio: "Portrait", headline: "3-bedroom house, Kibagabaga", subline: "3 bed · 2 bath · garden · 450 m²", chip: "120,000,000 RWF", name: "design-just-listed-portrait" },
    { project: "2-bedroom apartment for rent, Kimihurura", template: "Just listed", photo: 1, headline: "Furnished 2-bed apartment, Kimihurura", subline: "City views · security · backup power", chip: "600,000 RWF/month", name: "design-apartment", done: true },
    { project: "4-bedroom villa with pool, Nyarutarama", template: "Just listed", photo: 1, headline: "Villa with pool, Nyarutarama", subline: "4 en-suite bedrooms · 800 m² plot", chip: "350,000,000 RWF", name: "design-villa", done: true },
  ],
  nova: [
    { project: "Samsung Galaxy A56", template: "New arrival", photo: 1, headline: "Samsung Galaxy A56", subline: "256GB · 50MP camera · 12-month warranty", chip: "420,000 RWF", name: "design-a56", capture: true, done: true },
    { project: "Samsung Galaxy A56", template: "New arrival", photo: 1, ratio: "Portrait", headline: "Samsung Galaxy A56", subline: "256GB · 50MP camera · 12-month warranty", chip: "420,000 RWF", name: "design-a56-portrait" },
    { project: "iPhone 16", template: "New arrival", photo: 1, headline: "iPhone 16 is here", subline: "Genuine, sealed, 12-month warranty", chip: "1,150,000 RWF", name: "design-iphone", done: true },
    { project: "Fast chargers & cases", template: "Offer", photo: 1, headline: "Fast chargers & cases", subline: "Screen protector fitted free", chip: "From 5,000", name: "design-accessories", done: true },
    { project: "Samsung Galaxy A56", ai: true, template: "Offer", photo: 1, headline: "Galaxy A56 weekend deal", subline: "Trade in your old phone and save", chip: "420,000 RWF", scene: "The light blue phone held by a smiling young Rwandan man in a bright modern phone shop in Kigali", name: "design-ai-photo", capture: true, done: true },
  ],
};

const slug = process.argv[2];
const only = process.argv[3];
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS[slug].email]);
const browser = await launch();
const ctx = await newContext(browser);
const page = await login(ctx, slug);

for (const d of D[slug]) {
  if (only && d.name !== only) continue;
  if (!only && d.done) continue;
  const [project] = await q(`select id from "Project" where "businessId" = $1 and title = $2`, [biz.id, d.project]);
  const before = (await q(`select count(*)::int n from "Design" where "projectId" = $1`, [project.id]))[0].n;
  await go(page, `/dashboard/projects/${project.id}`);
  const studio = page.getByRole("tabpanel").filter({ has: page.getByRole("group", { name: "Template" }) });
  if (d.ai) await studio.getByRole("group", { name: "How to make it" }).getByRole("button").nth(1).click();
  await studio.getByRole("group", { name: "Template" }).getByRole("button", { name: d.template, exact: true }).click();
  const inputs = studio.locator("input[maxlength='140'], input[maxlength='180'], input[maxlength='40']");
  await inputs.nth(0).fill(d.headline);
  await inputs.nth(1).fill(d.subline);
  await inputs.nth(2).fill(d.chip);
  if (d.scene) await studio.locator("textarea[maxlength='400']").fill(d.scene);
  await studio.getByRole("button", { name: `Photo ${d.photo}`, exact: true }).click();
  if (d.ratio) await studio.getByRole("group", { name: "Shape" }).getByRole("button", { name: d.ratio, exact: true }).click();
  await settle(page, 800);
  if (d.capture) {
    await studio.getByRole("group", { name: "Template" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await shot(page, slug, `${d.name}-form`);
  }
  await studio.getByRole("button", { name: d.ai ? "Create with AI photo" : "Create design", exact: true }).click();
  let row;
  for (let i = 0; i < 240 && !row; i++) {
    [row] = await q(`select id, path from "Design" where "projectId" = $1 order by "createdAt" desc offset 0 limit 1`, [project.id]);
    if ((await q(`select count(*)::int n from "Design" where "projectId" = $1`, [project.id]))[0].n <= before) row = undefined;
    if (!row) await page.waitForTimeout(1000);
  }
  if (!row) throw new Error(`design not made: ${d.name}`);
  // Keep the PNG itself too (the real output), for the video.
  const { data } = await admin.storage.from("designs").download(row.path);
  fs.mkdirSync(path.join(SCREENS, slug), { recursive: true });
  fs.writeFileSync(path.join(SCREENS, slug, `${d.name}-output.png`), Buffer.from(await data.arrayBuffer()));
  if (d.capture) {
    const img = page.getByRole("img", { name: "Your new design" });
    await img.waitFor({ timeout: 60_000 }).catch(() => {});
    // The result is shown full width; keep it to a screen-friendly size so the buttons under it are in the shot.
    await page.addStyleTag({ content: `img[alt="Your new design"] { max-height: 600px; width: auto !important; align-self: flex-start; }` });
    await settle(page, 1500);
    await page.getByRole("tablist", { name: "Design type" }).scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy(0, -60));
    await shot(page, slug, `${d.name}-result`);
  }
  console.log("design", d.name, row.id);
}
await browser.close();
await pool.end();
