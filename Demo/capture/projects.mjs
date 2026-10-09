// Creates the demo projects through the real "New project" form (photos uploaded, AI content written by the app).
// Usage: node projects.mjs inzu|urugo|nova     (skips projects whose title already exists)
import path from "node:path";
import { q, pool } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { ASSETS, waitPath, go, launch, login, newContext, settle, shot } from "./lib.mjs";

const photo = (n) => path.join(ASSETS, "jpg", `${n}.jpg`);
export const PROJECTS = {
  inzu: [
    {
      type: "Product", title: "Kitenge summer dress", price: "25,000 RWF", generate: true, shotForm: true,
      features: ["100% cotton wax print", "Sizes S to XXL", "Knee length with side pockets", "Free alterations in store"],
      details: "New this week in terracotta and gold. Light and comfortable for Kigali sunshine, perfect for work, church or a weekend out. Only 12 pieces in stock. Delivery anywhere in Kigali for 2,000 RWF.",
      photos: ["inzu-dress-1", "inzu-dress-2", "inzu-dress-3"],
    },
    {
      type: "Product", title: "Men's African print shirt", price: "18,000 RWF", generate: false,
      features: ["Short sleeves", "Sizes M to XXXL", "Blue and orange wax print"],
      details: "Smart casual shirt for Friday at the office or a wedding introduction (gusaba).",
      photos: ["inzu-shirt"],
    },
    {
      type: "Product", title: "Head wraps & beaded accessories", price: "From 5,000 RWF", generate: false,
      features: ["Matching kitenge head wraps", "Handmade beaded bracelets", "Kitenge clutch bags"],
      details: "Finish your look with accessories that match our dresses.",
      photos: ["inzu-accessories"],
    },
  ],
  urugo: [
    {
      type: "Listing", title: "3-bedroom house, Kibagabaga", price: "120,000,000 RWF", generate: true, shotForm: true,
      features: ["3 bedrooms, 2 bathrooms", "Garden and parking for 2 cars", "Plot of 450 m²", "Paved road, 5 min to Kibagabaga Hospital"],
      details: "Family house for sale in a quiet, secure neighbourhood of Kibagabaga. Bright living room, fitted kitchen, staff quarters and a mature garden with bougainvillea. Freehold title, ready to move in. Viewings this week by appointment.",
      photos: ["urugo-house", "urugo-living"],
    },
    {
      type: "Listing", title: "2-bedroom apartment for rent, Kimihurura", price: "600,000 RWF/month", generate: true,
      features: ["2 bedrooms, 2 bathrooms", "Fully furnished", "City view balcony", "24/7 security and backup power"],
      details: "Modern furnished apartment in Kimihurura, close to the Convention Centre and Kigali Golf Club. Water and internet included. Available from 1 November, minimum 6-month lease.",
      photos: ["urugo-apartment"],
    },
    {
      type: "Listing", title: "4-bedroom villa with pool, Nyarutarama", price: "350,000,000 RWF", generate: true,
      features: ["4 en-suite bedrooms", "Swimming pool", "Plot of 800 m²", "Views over Kigali"],
      details: "Contemporary villa in Nyarutarama, minutes from the Kigali Golf Club and international schools. Open-plan living, solar water heating and a double garage.",
      photos: ["urugo-villa"],
    },
  ],
  nova: [
    {
      type: "Product", title: "Samsung Galaxy A56", price: "420,000 RWF", generate: true, shotForm: true,
      features: ["8GB RAM, 256GB storage", "50MP triple camera", "45W fast charging", "12-month warranty"],
      details: "In stock in black, light blue and pink. Trade in your old phone and pay less. MoMo instalments over 3 months available. Free delivery in Kigali.",
      photos: ["nova-a56"],
    },
    {
      type: "Product", title: "iPhone 16", price: "1,150,000 RWF", generate: true,
      features: ["128GB, genuine and sealed", "48MP camera", "12-month warranty", "Free screen protector fitted"],
      details: "New stock just arrived. 256GB also available at 1,290,000 RWF. Trade-ins accepted.",
      photos: ["nova-iphone"],
    },
    {
      type: "Offer", title: "Fast chargers & cases", price: "From 5,000 RWF", generate: false,
      features: ["25W and 45W fast chargers", "Cases from 5,000 RWF", "Screen protectors fitted free"],
      details: "Everything your phone needs, tested and with warranty.",
      photos: ["nova-accessories"],
    },
  ],
};

const slug = process.argv[2];
const a = ACCOUNTS[slug];
const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [a.email]);
const existing = new Set((await q(`select title from "Project" where "businessId" = $1`, [biz.id])).map((r) => r.title));

const browser = await launch();
const ctx = await newContext(browser);
const page = await login(ctx, slug);
for (const p of [...PROJECTS[slug]].reverse()) {
  if (existing.has(p.title)) continue;
  await go(page, "/dashboard/projects/new");
  await page.getByRole("group", { name: "Project type" }).getByRole("button", { name: p.type, exact: true }).click();
  await page.getByLabel("Name").fill(p.title);
  await page.getByLabel("Price or offer (optional)").fill(p.price);
  const feat = page.getByLabel(/Key features/);
  for (const f of p.features) { await feat.fill(f); await feat.press("Enter"); }
  await page.getByLabel("Extra details (optional)").fill(p.details);
  await page.setInputFiles('input[type="file"]', p.photos.map(photo));
  await page.getByText("Waiting for photos to finish uploading").waitFor({ state: "detached", timeout: 120_000 }).catch(() => {});
  await settle(page, 2500);
  if (p.shotForm) {
    await shot(page, slug, "new-project-form");
    await shot(page, slug, "new-project-form", { fullPage: true });
  }
  if (p.generate) await page.getByRole("button", { name: "Create and write content" }).click();
  else await page.getByRole("button", { name: "Save as draft" }).click();
  // The dev server's client navigation is unreliable, so wait for the saved rows and open the page directly.
  let row;
  for (let i = 0; i < 360 && !row; i++) {
    [row] = await q(`select p.id from "Project" p where p."businessId" = $1 and p.title = $2 ${p.generate ? `and exists (select 1 from "GeneratedContent" g where g."projectId" = p.id)` : ""}`, [biz.id, p.title]);
    if (!row) await page.waitForTimeout(1000);
  }
  if (!row) throw new Error(`not saved: ${p.title}`);
  console.log("created", p.title, row.id);
}
await browser.close();
await pool.end();
