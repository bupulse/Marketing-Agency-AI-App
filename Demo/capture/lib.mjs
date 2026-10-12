// Shared Playwright helpers for the demo capture scripts.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ROOT } from "./db.mjs";
import { ACCOUNTS, demoPassword } from "./accounts.mjs";

export const BASE = process.env.CAPTURE_BASE ?? "http://localhost:3100";
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

export async function launch({ localNetwork = false } = {}) {
  // localNetwork: lets the fake shop site (https://novaphones.rw, served by Playwright) load the widget from localhost.
  const args = localNetwork ? ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"] : [];
  return chromium.launch({ channel: "chrome", args });
}

export async function newContext(browser, { slug, mobile = false, reducedMotion = "no-preference" } = {}) {
  const statePath = slug ? path.join(STATE, `${slug}.json`) : undefined;
  const ctx = await browser.newContext({
    ...(mobile ? MOBILE : DESKTOP),
    colorScheme: "light",
    reducedMotion,
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
  const statePath = path.join(STATE, `${slug}.json`);
  if (fs.existsSync(statePath)) {
    await ctx.addCookies(JSON.parse(fs.readFileSync(statePath, "utf8")).cookies);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    if (!new URL(page.url()).pathname.startsWith("/login")) return page;
  }
  await page.goto(`${BASE}/login`, { timeout: 180_000 });
  await page.fill('input[name="email"]', ACCOUNTS[slug]?.email ?? slug);
  await page.fill('input[name="password"]', demoPassword());
  await page.click('form:has(input[name="password"]) button[type="submit"]');
  // The session cookie is set by the sign-in action; the redirect after it is not always followed by the dev server.
  for (let i = 0; i < 240; i++) {
    if ((await ctx.cookies()).some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) break;
    await page.waitForTimeout(500);
  }
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await ctx.storageState({ path: statePath });
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
  await page.goto(url.startsWith("http") ? url : `${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await settle(page, ms);
}

// Client-side (router) navigations do not always fire a navigation event, so poll the location.
export async function waitPath(page, test, timeout = 180_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (test(new URL(page.url()).pathname)) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`timed out waiting for path, at ${page.url()}`);
}

// Scrolls through the page so scroll-reveal animations run, then back to the top.
export async function revealAll(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight / 2;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
}

// Hides the home page testimonials, which still hold placeholder text.
export async function hidePlaceholders(page) {
  await page.addStyleTag({ content: `section[aria-labelledby="testimonials-title"] { display: none !important; }` });
}
