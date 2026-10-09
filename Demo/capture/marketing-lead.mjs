// Public marketing pages for the intro video (captured by the lead). Run from the repo root: node Demo/capture/marketing-lead.mjs
import { chromium } from "@playwright/test";

const OUT = "Demo/studio/public/screens/marketing";
const browser = await chromium.launch({ channel: "chrome" });
const settle = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; } *, *::before, *::after { animation-play-state: paused !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
};
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
const p = await desktop.newPage();
await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await settle(p);
await p.screenshot({ path: `${OUT}/home.png` });
// Scroll through once so scroll-reveal content is shown before the full-page capture.
await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/home-full.png`, fullPage: true });
await p.goto("http://localhost:3000/signup", { waitUntil: "domcontentloaded" });
await settle(p);
await p.screenshot({ path: `${OUT}/signup.png` });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "light", reducedMotion: "reduce", isMobile: true, hasTouch: true });
const m = await mobile.newPage();
await m.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await settle(m);
await m.screenshot({ path: `${OUT}/home-m.png` });
await browser.close();
console.log("done");
