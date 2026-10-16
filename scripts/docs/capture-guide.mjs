// Screenshots and short silent clips for the BuPulse guide (docs/guide). Read-only: it signs in with the test accounts,
// opens pages, scrolls and hovers; it never submits a form, generates content or saves anything.
//
//   node scripts/docs/capture-guide.mjs [--only=public,client,mobile,clips] [--base=http://localhost:3001]
//
// Needs the app running against the TEST database (npx next start -p 3001) and TEST_ACCOUNTS.md (git-ignored) for the
// passwords, which are read here and never printed. Output: docs/guide/images/<group>/<name>.jpg, docs/guide/videos/<name>.webm
// and docs/guide/images/manifest.json (what each capture shows: URL, page title, first heading).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/guide");
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://localhost:3001");
const ONLY = new Set(arg("only", "public,client,mobile,clips").split(","));
const STATE = path.join(ROOT, ".playwright-guide");
fs.mkdirSync(STATE, { recursive: true });

const NOVA = "e.cyusa21+nova@gmail.com";
const URUGO = "e.cyusa21+urugo@gmail.com";
const INZU = "e.cyusa21+inzu@gmail.com";
const ONBOARD = "e.cyusa21+e2e-onboard-1@gmail.com";

function passwordOf(email) {
  const line = fs.readFileSync(path.join(ROOT, "TEST_ACCOUNTS.md"), "utf8").split("\n").find((l) => l.includes(`| ${email} |`));
  const pw = line?.match(/`([^`]+)`/)?.[1];
  if (!pw) throw new Error(`No password for ${email} in TEST_ACCOUNTS.md`);
  return pw;
}

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const HIDE = "nextjs-portal,[data-nextjs-toast]{display:none!important} *{caret-color:transparent!important}";
const manifest = fs.existsSync(path.join(OUT, "images/manifest.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "images/manifest.json"), "utf8")) : {};

async function context(browser, { email, mobile = false, video = false } = {}) {
  const statePath = email ? path.join(STATE, `${email.replace(/[^a-z0-9]/gi, "_")}.json`) : null;
  const ctx = await browser.newContext({
    ...(mobile ? MOBILE : DESKTOP),
    colorScheme: "light",
    reducedMotion: video ? "no-preference" : "reduce",
    locale: "en-GB",
    timezoneId: "Africa/Kigali",
    ...(statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}),
    ...(video ? { recordVideo: { dir: path.join(STATE, "video"), size: { width: 1280, height: 800 } }, viewport: { width: 1280, height: 800 } } : {}),
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("bp-theme", "light");
    } catch {}
  });
  if (email) await signIn(ctx, email, statePath);
  return ctx;
}

async function signIn(ctx, email, statePath) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (!new URL(page.url()).pathname.startsWith("/login")) return page.close();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', passwordOf(email));
  await page.click('form:has(input[name="password"]) button[type="submit"]');
  for (let i = 0; i < 120; i++) {
    if ((await ctx.cookies()).some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) break;
    await page.waitForTimeout(500);
  }
  await ctx.storageState({ path: statePath });
  await page.close();
}

async function settle(page, ms = 600) {
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

async function shoot(ctx, group, name, url, { fullPage = false } = {}) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page);
    const file = path.join(OUT, "images", group, `${name}.jpg`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, type: "jpeg", quality: 82, fullPage });
    const info = await page.evaluate(() => ({ title: document.title, h1: document.querySelector("h1")?.textContent?.trim() ?? null }));
    manifest[`${group}/${name}.jpg`] = { url, finalPath: new URL(page.url()).pathname, ...info, fullPage };
    console.log(`ok  ${group}/${name}  ${new URL(page.url()).pathname}`);
  } catch (e) {
    console.log(`ERR ${group}/${name}  ${url}  ${String(e.message).split("\n")[0]}`);
  } finally {
    await page.close();
  }
}

/** The first link on `listUrl` whose path matches `pattern` (for pages that need an id). */
async function firstLink(ctx, listUrl, pattern) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}${listUrl}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page, 200);
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    return hrefs.find((h) => h && pattern.test(h)) ?? null;
  } finally {
    await page.close();
  }
}

const PUBLIC = [
  ["home", "/"], ["pricing", "/pricing"], ["about", "/about"], ["industries", "/industries"], ["done-for-you", "/done-for-you"],
  ["contact", "/contact"], ["blog", "/blog"], ["signup", "/signup"], ["login", "/login"], ["forgot-password", "/forgot-password"],
  ["privacy", "/privacy"], ["terms", "/terms"], ["refund-policy", "/refund-policy"], ["data-deletion", "/data-deletion"],
];

const CLIENT = [
  "", "analytics", "autopilot", "billing", "brand", "calendar", "connections", "connectors", "connectors/api", "connectors/webhooks",
  "content", "content/general", "content/settings", "designs", "domains", "gallery", "knowledge", "knowledge/profile", "knowledge/products",
  "knowledge/audience", "knowledge/campaigns", "knowledge/competitors", "knowledge/faqs", "knowledge/interview", "knowledge/locations",
  "knowledge/reviews", "knowledge/products/new", "leads", "settings", "settings/team", "stores", "usage", "widget",
];
// /dashboard/projects* now redirects to the Knowledge base; /dashboard/upgrade answers 404 for a paying company.
// Pages that need an id (their lists open rows by click, not by link): --detail=name=/dashboard/...,name=/dashboard/...
const DETAILS = arg("detail", "").split(",").filter(Boolean).map((d) => d.split("="));
const slugOf = (p) => (p ? p.replace(/\//g, "-") : "home");

async function run() {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    if (ONLY.has("public")) {
      const ctx = await context(browser);
      for (const [name, url] of PUBLIC) await shoot(ctx, "public", name, url);
      await shoot(ctx, "public", "home-full", "/", { fullPage: true });
      await shoot(ctx, "public", "pricing-full", "/pricing", { fullPage: true });
      await ctx.close();
    }
    if (ONLY.has("client")) {
      const nova = await context(browser, { email: NOVA });
      for (const p of CLIENT) await shoot(nova, "client", slugOf(p), `/dashboard${p ? `/${p}` : ""}`);
      for (const [name, url] of DETAILS) await shoot(nova, "client", name, url);
      await shoot(nova, "client", "home-full", "/dashboard", { fullPage: true });
      await nova.close();
      // Other states: a trial (Urugo), a new account still in onboarding (Inzu), and an onboarded account choosing a plan.
      const urugo = await context(browser, { email: URUGO });
      await shoot(urugo, "states", "trial-home", "/dashboard");
      await shoot(urugo, "states", "trial-billing", "/dashboard/billing");
      await urugo.close();
      const inzu = await context(browser, { email: INZU });
      await shoot(inzu, "states", "onboarding", "/onboarding");
      await inzu.close();
      const onboard = await context(browser, { email: ONBOARD });
      await shoot(onboard, "states", "book-demo", "/book-demo");
      await shoot(onboard, "states", "book-demo-full", "/book-demo", { fullPage: true });
      await shoot(onboard, "states", "custom-plan", "/custom-plan");
      await onboard.close();
    }
    if (ONLY.has("details") && !ONLY.has("client")) {
      const nova = await context(browser, { email: NOVA });
      for (const [name, url] of DETAILS) await shoot(nova, "client", name, url);
      await nova.close();
    }
    if (ONLY.has("mobile")) {
      const m = await context(browser, { email: NOVA, mobile: true });
      for (const p of ["", "content", "calendar", "leads", "widget", "billing"]) await shoot(m, "mobile", slugOf(p), `/dashboard${p ? `/${p}` : ""}`);
      await m.close();
      const pub = await context(browser, { mobile: true });
      await shoot(pub, "mobile", "public-home", "/");
      await shoot(pub, "mobile", "public-pricing", "/pricing");
      await pub.close();
    }
    if (ONLY.has("clips")) await clips(browser);
  } finally {
    await browser.close();
    fs.mkdirSync(path.join(OUT, "images"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "images/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

// ---- clips: navigate, scroll and hover only --------------------------------------------------------------------

async function scrollThrough(page, steps = 6, dy = 260) {
  await page.mouse.move(700, 450);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(650);
  }
  await page.waitForTimeout(500);
}

async function open(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await settle(page, 900);
}

async function clickLink(page, re) {
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const href = hrefs.find((h) => h && re.test(h));
  if (!href) return false;
  const link = page.locator(`a[href="${href}"]`).first();
  await link.hover().catch(() => {});
  await page.waitForTimeout(400);
  await link.click().catch(() => {});
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await settle(page, 900);
  return true;
}

const CLIPS = {
  "tour-dashboard": async (page) => {
    await open(page, "/dashboard");
    await scrollThrough(page, 5);
    for (const p of ["/dashboard/content", "/dashboard/calendar", "/dashboard/leads", "/dashboard/widget"]) {
      if (!(await clickLink(page, new RegExp(`^${p}$`)))) await open(page, p);
      await page.waitForTimeout(800);
    }
  },
  "content-post": async (page) => {
    await open(page, "/dashboard/projects");
    await page.waitForTimeout(600);
    if (!(await clickLink(page, /^\/dashboard\/projects\/[^/]+$/))) return;
    await scrollThrough(page, 8);
  },
  calendar: async (page) => {
    await open(page, "/dashboard/calendar");
    await scrollThrough(page, 4);
  },
  leads: async (page) => {
    await open(page, "/dashboard/leads");
    await page.waitForTimeout(600);
    if (await clickLink(page, /^\/dashboard\/leads\/[^/]+$/)) await scrollThrough(page, 4);
  },
  "website-chat": async (page) => {
    await open(page, "/dashboard/widget");
    await scrollThrough(page, 8);
  },
  knowledge: async (page) => {
    await open(page, "/dashboard/knowledge");
    await scrollThrough(page, 3);
    for (const p of ["/dashboard/knowledge/profile", "/dashboard/knowledge/products", "/dashboard/knowledge/faqs"]) {
      if (!(await clickLink(page, new RegExp(`^${p}$`)))) await open(page, p);
      await scrollThrough(page, 2);
    }
  },
  autopilot: async (page) => {
    await open(page, "/dashboard/autopilot");
    await scrollThrough(page, 6);
  },
  billing: async (page) => {
    await open(page, "/dashboard/billing");
    await scrollThrough(page, 6);
  },
  analytics: async (page) => {
    await open(page, "/dashboard/analytics");
    await scrollThrough(page, 6);
  },
  "public-signup": async (page) => {
    await open(page, "/");
    await scrollThrough(page, 6, 400);
    await open(page, "/pricing");
    await scrollThrough(page, 4, 300);
    await open(page, "/signup");
    // Typed only to show the form; it is never submitted.
    const fields = await page.$$("form input:not([type=hidden]):not([type=checkbox]):not([type=password])");
    const sample = ["Imena Cafe", "Grace Mukamana", "grace@example.com"];
    for (let i = 0; i < Math.min(fields.length, sample.length); i++) await fields[i].type(sample[i], { delay: 45 }).catch(() => {});
    await page.waitForTimeout(1200);
  },
};

async function clips(browser) {
  fs.mkdirSync(path.join(OUT, "videos"), { recursive: true });
  for (const [name, fn] of Object.entries(CLIPS)) {
    const ctx = await context(browser, { email: name.startsWith("public-") ? undefined : NOVA, video: true });
    const page = await ctx.newPage();
    try {
      await fn(page);
    } catch (e) {
      console.log(`ERR clip ${name}: ${String(e.message).split("\n")[0]}`);
    }
    const video = page.video();
    await ctx.close();
    if (video) {
      const file = path.join(OUT, "videos", `${name}.webm`);
      await video.saveAs(file).catch((e) => console.log(`ERR save ${name}: ${e.message}`));
      console.log(`ok  clip ${name}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
    }
  }
}

await run();
