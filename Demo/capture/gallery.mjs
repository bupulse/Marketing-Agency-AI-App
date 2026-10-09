// Fills each demo Gallery: folders are created as rows, photos are uploaded through the real Gallery page into each folder.
// Usage: node gallery.mjs inzu|urugo|nova
import crypto from "node:crypto";
import path from "node:path";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { ASSETS, go, launch, login, newContext } from "./lib.mjs";

const FOLDERS = {
  inzu: { Dresses: ["inzu-dress-1", "inzu-dress-2", "inzu-dress-3"], Shirts: ["inzu-shirt"], Accessories: ["inzu-accessories"] },
  urugo: { "Kibagabaga house": ["urugo-house", "urugo-living"], "Kimihurura apartment": ["urugo-apartment"], "Nyarutarama villa": ["urugo-villa"] },
  nova: { Phones: ["nova-a56", "nova-iphone"], Accessories: ["nova-accessories"], "Our shop": ["nova-shop"] },
};
const slug = process.argv[2];
const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS[slug].email]);
const browser = await launch();
const ctx = await newContext(browser);
const page = await login(ctx, slug);
for (const [name, photos] of Object.entries(FOLDERS[slug])) {
  await q(`insert into "MediaFolder"(id, "businessId", name) values ($1, $2, $3) on conflict ("businessId", name) do nothing`, ["demo" + crypto.randomBytes(10).toString("hex"), biz.id, name]);
  const [folder] = await q(`select id, (select count(*)::int from "MediaAsset" a where a."folderId" = f.id) n from "MediaFolder" f where "businessId" = $1 and name = $2`, [biz.id, name]);
  if (folder.n >= photos.length) continue;
  await go(page, `/dashboard/gallery?folder=${folder.id}`);
  await page.setInputFiles('input[type="file"]', photos.map((p) => path.join(ASSETS, "jpg", `${p}.jpg`)));
  for (let i = 0; i < 120; i++) {
    const [{ n }] = await q(`select count(*)::int n from "MediaAsset" where "folderId" = $1`, [folder.id]);
    if (n >= photos.length) break;
    await page.waitForTimeout(1000);
  }
  console.log(slug, name, "uploaded");
}
await browser.close();
await pool.end();
