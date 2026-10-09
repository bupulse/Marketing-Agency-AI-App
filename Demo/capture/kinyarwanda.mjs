// Inzu Fashion: writes a Kinyarwanda version of the kitenge dress content with the app itself
// (Brand → Language = Kinyarwanda, then Regenerate on the project), then sets the language back to English.
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { go, launch, login, newContext } from "./lib.mjs";

const [biz] = await q(`select b.id from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS.inzu.email]);
const [p] = await q(`select id from "Project" where "businessId" = $1 and title = 'Kitenge summer dress'`, [biz.id]);
const count = async () => (await q(`select count(*)::int n from "GeneratedContent" where "projectId" = $1 and language = 'Kinyarwanda'`, [p.id]))[0].n;
if ((await count()) === 0) {
  const browser = await launch();
  const ctx = await newContext(browser);
  const page = await login(ctx, "inzu");
  await go(page, "/dashboard/brand");
  const section = page.locator("section[aria-labelledby='brand-language']");
  await section.locator("select").selectOption("Kinyarwanda");
  await section.getByRole("button", { name: "Save" }).click();
  for (let i = 0; i < 120 && (await q(`select "contentLanguage" l from "Business" where id = $1`, [biz.id]))[0].l !== "Kinyarwanda"; i++) await page.waitForTimeout(1000);
  await go(page, `/dashboard/projects/${p.id}`);
  await page.getByRole("button", { name: "Regenerate" }).click();
  for (let i = 0; i < 900 && (await count()) === 0; i++) await page.waitForTimeout(1000);
  await browser.close();
}
await q(`update "Business" set "contentLanguage" = 'English' where id = $1`, [biz.id]);
console.log(await q(`select language, left(caption, 300) c, "adHeadlines" from "GeneratedContent" where "projectId" = $1 order by "createdAt"`, [p.id]));
await pool.end();
