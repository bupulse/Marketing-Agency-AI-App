// Shared Playwright helpers for the demo capture scripts.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ROOT } from "./db.mjs";
import { ACCOUNTS, PASSWORD } from "./accounts.mjs";

export const BASE = process.env.CAPTURE_BASE ?? "http://localhost:3000";
export const SCREENS = path.join(ROOT, "Demo/studio/public/screens");
export const STATE = path.join(ROOT, "Demo/capture/.state");
export const ASSETS = path.join(ROOT, "Demo/capture/assets");
fs.mkdirSync(STATE, { recursive: true });

export const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

// Hides the Next.js dev indicator / overlay and stops animations so captures are stable.
const HIDE_CSS = `
  nextjs-portal, [data-nextjs-toast], [data-next-badge-root], #__next-build-watcher { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

export async function launch() {
  return chromium.launch({ channel: "chrome" });
}

export async function newContext(browser, { slug, mobile = false } = {}) {
  const statePath = slug ? path.join(STATE, `${slug}.json`) : undefined;
  const ctx = await browser.newContext({
    ...(mobile ? MOBILE : DESKTOP),
    colorScheme: "light",
    locale: "en-GB",
    timezoneId: "Africa/Kigali",
    ...(statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}),
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("bp-theme", "light"); } catch {}
  });
  return ctx;
}

export async function login(ctx, slug) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', ACCOUNTS[slug]?.email ?? slug);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }), page.click('form:has(input[name="password"]) button[type="submit"]')]);
  await ctx.storageState({ path: path.join(STATE, `${slug}.json`) });
  return page;
}

export async function settle(page, ms = 800) {
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Wait for images to finish loading.
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); })));
  }).catch(() => {});
  await page.waitForTimeout(ms);
}

export async function shot(page, slug, name, { fullPage = false, mobile = false, clip } = {}) {
  const dir = path.join(SCREENS, slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}${fullPage ? "-full" : ""}${mobile ? "-m" : ""}.png`);
  await settle(page, 300);
  await page.screenshot({ path: file, fullPage, clip, animations: "disabled" });
  console.log("shot", path.relative(ROOT, file));
  return file;
}

export async function go(page, url, ms) {
  await page.goto(url.startsWith("http") ? url : `${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await settle(page, ms);
}
