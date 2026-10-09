// Real website-chat conversations for Nova Phones on a fake shop website (https://novaphones.rw is served by Playwright,
// the widget and the AI replies come from the local BuPulse). Lead emails are switched off first.
// Usage: node widget-chat.mjs desktop|mobile
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { ASSETS, BASE, launch, newContext, settle, shot } from "./lib.mjs";

const mode = process.argv[2] ?? "desktop";
const mobile = mode === "mobile";
const SCRIPTS = {
  desktop: {
    visitor: { name: "Divine Mukamana", phone: "+250 783 556 120" },
    messages: ["Hello! Do you have the Samsung A56? What's the price?", "Nice. Is it available in light blue, and can I pay with MoMo in instalments?", "Yes please, I'd like to reserve one and pick it up tomorrow."],
  },
  mobile: {
    visitor: { name: "Olivier Niyonzima", phone: "+250 722 418 903" },
    messages: ["Hi, how much is the iPhone 16?", "Can I trade in my iPhone 12 to pay less?", "Ok great, can someone call me to value it?"],
  },
};
const s = SCRIPTS[mode];

const [biz] = await q(`select b.id, b."widgetKey" from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS.nova.email]);
await q(
  `insert into "ChatWidget"("businessId", enabled, greeting, position, "accentColor", "allowedDomains", "notifyInstant", "notifyDaily", "updatedAt")
   values ($1, true, $2, 'right', '#0A84FF', array['novaphones.rw'], false, false, now())
   on conflict ("businessId") do update set enabled = true, "allowedDomains" = array['novaphones.rw'], "notifyInstant" = false, "notifyDaily" = false, "accentColor" = '#0A84FF', greeting = $2`,
  [biz.id, "Muraho! 👋 Welcome to Nova Phones Kigali. Ask me about phones, prices, trade-ins or repairs."],
);

const html = fs.readFileSync(path.join(ASSETS, "../site/nova.html"), "utf8").replace("__BUPULSE__", BASE).replace("__KEY__", biz.widgetKey);
const browser = await launch({ localNetwork: true });
const ctx = await newContext(browser, { mobile });
// The widget mounts in a closed shadow root; open it on this test page only so Playwright can click the launcher.
await ctx.addInitScript(() => {
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) { return orig.call(this, { ...init, mode: "open" }); };
});
await ctx.route("https://novaphones.rw/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/" ) return route.fulfill({ status: 200, contentType: "text/html", body: html });
  const asset = url.pathname.match(/^\/assets\/(.+)$/)?.[1];
  if (asset === "logo.png") return route.fulfill({ path: path.join(ASSETS, "logos/nova.png") });
  if (asset) return route.fulfill({ path: path.join(ASSETS, "jpg", asset) });
  return route.fulfill({ status: 404, body: "" });
});
const page = await ctx.newPage();
page.on("console", (msg) => console.log("console:", msg.type(), msg.text().slice(0, 300)));
page.on("requestfailed", (r) => console.log("failed:", r.url().slice(0, 120), r.failure()?.errorText));
await page.goto("https://novaphones.rw/");
await settle(page, 1500);
const launcher = page.locator("#bupulse-widget button").first();
await launcher.waitFor({ timeout: 20_000 });
const m = { mobile };
const name = mobile ? "chat-site" : "chat-site";
await shot(page, "nova", name, m);
await launcher.click();
const frame = page.frameLocator("#bupulse-widget iframe");
const input = frame.locator('input[type="text"][enterkeyhint="send"]');
await input.waitFor({ timeout: 120_000 });
await settle(page, 1500);
await shot(page, "nova", "chat-open", m);

const sessionsBefore = (await q(`select count(*)::int n from "ChatMessage" cm join "ChatSession" cs on cs.id = cm."sessionId" where cs."businessId" = $1 and cm.role = 'assistant'`, [biz.id]))[0].n;
let replies = sessionsBefore;
for (const [i, text] of s.messages.entries()) {
  await input.fill(text);
  await input.press("Enter");
  for (let t = 0; t < 120; t++) {
    const n = (await q(`select count(*)::int n from "ChatMessage" cm join "ChatSession" cs on cs.id = cm."sessionId" where cs."businessId" = $1 and cm.role = 'assistant'`, [biz.id]))[0].n;
    if (n > replies) { replies = n; break; }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2500);
  await settle(page, 500);
  await shot(page, "nova", `chat-reply-${i + 1}`, m);
  if (await frame.locator("form.card").count()) break;
}
const card = frame.locator("form.card");
if (await card.count()) {
  await card.locator('input[name="name"]').fill(s.visitor.name);
  await card.locator('input[name="phone"]').fill(s.visitor.phone);
  await settle(page, 300);
  await shot(page, "nova", "chat-lead-form", m);
  await card.locator('button[type="submit"]').click();
  await page.waitForTimeout(6000);
  await shot(page, "nova", "chat-lead-sent", m);
} else console.log("no contact card was offered");
console.log(await q(`select name, phone, interest, source, "pageUrl" from "Lead" where "businessId" = $1 order by "createdAt" desc limit 2`, [biz.id]));
void crypto;
await browser.close();
await pool.end();
