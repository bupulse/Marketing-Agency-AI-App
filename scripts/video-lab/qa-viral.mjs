// QA crawl for the Viral library page (/viral) of the Video Studio. Needs the studio running (npm run lab).
// Run: node scripts/video-lab/qa-viral.mjs   (STUDIO_URL=http://localhost:3100 by default; add --headed to watch)
// Checks at 1440 px and 390 px wide: the page loads with no errors, the filters change the count, a card opens its
// drawer, a frame image loads (when frames exist), no sideways scroll, and the frame route refuses bad paths.
import { chromium } from "@playwright/test";

const base = process.env.STUDIO_URL || "http://localhost:3100";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
for (const [label, width, height] of [["desktop", 1440, 900], ["phone", 390, 800]]) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(m.text()));
  const res = await page.goto(`${base}/viral`, { waitUntil: "networkidle" });
  check(`${label}: /viral loads`, res?.status() === 200);
  const total = await page.locator(".vCard").count();
  const empty = await page.locator("#vEmpty").isVisible();
  check(`${label}: shows cards, or the empty message when there are none`, total > 0 || empty, `${total} cards`);
  check(`${label}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  if (total > 0) {
    // Filters: the platform tab, the ads checkbox and the search box each change the number of cards.
    const tabs = page.locator("#vTabs button");
    if ((await tabs.count()) > 2) {
      await tabs.nth(1).click();
      const n = await page.locator(".vCard").count();
      check(`${label}: a platform tab changes the count`, n < total || total === 1, `${total} to ${n}`);
      await tabs.nth(0).click();
    }
    await page.locator("#vAds").check();
    const ads = await page.locator(".vCard").count();
    check(`${label}: "ads only" changes the count`, ads < total, `${total} to ${ads}`);
    await page.locator("#vAds").uncheck();
    await page.fill("#vSearch", "zzzz-no-such-word");
    check(`${label}: search to nothing shows the no-match note`, (await page.locator(".vCard").count()) === 0 && (await page.locator("#vNone").isVisible()));
    await page.fill("#vSearch", "");
    // A card opens the drawer, with a frame that loads when the row has frames.
    await page.locator(".vCard").first().click();
    await page.waitForSelector("#vDrawer.open");
    check(`${label}: a card opens its drawer`, await page.locator("#vdSide .vBlock").first().isVisible());
    const img = page.locator("#vdPhone img").first();
    if (await img.count()) check(`${label}: the frame image loads`, await img.evaluate((i) => i.complete && i.naturalWidth > 0));
    check(`${label}: "Make a video like this" opens /create with a note`, /\/create\?prompt=/.test((await page.locator(".vMakeBtn").getAttribute("href")) ?? ""));
    check(`${label}: no player loads before "Play" is clicked`, (await page.locator("#vdPhone iframe").count()) === 0);
    await page.click("#vdClose");
    check(`${label}: the drawer closes`, !(await page.locator("#vDrawer.open").count()));
  }
  check(`${label}: no script or console errors`, errors.length === 0, errors.join(" | ").slice(0, 200));
  await page.context().close();
}

// The frame route refuses anything that is not a frame.
const bad = ["tiktok/vt-tt-001/f1.jpg/../../../x", "tiktok/..%2f..%2fvt-tt-001/f1.jpg", "tiktok/vt-xx-001/f1.jpg", "tiktok/vt-tt-1/f1.jpg", "other/vt-tt-001/f1.jpg", "tiktok/vt-tt-001/f10.jpg", "tiktok/vt-tt-001/f1.png", "tiktok/vt-tt-001/..", "../../etc/passwd"];
for (const p of bad) {
  const r = await fetch(`${base}/viral/frames/${p}`, { redirect: "manual" });
  check(`frame route refuses /viral/frames/${p}`, r.status === 404 || r.status === 400 || r.status === 302);
}
await browser.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
