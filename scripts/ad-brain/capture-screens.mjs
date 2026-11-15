#!/usr/bin/env node
// The Ad Brain's screen robot (docs/AD_BRAIN.md, section 7): opens the BuPulse company account's real dashboard pages in
// headless Chrome with the server's 5-minute read-only pass (lib/ad-brain/screen-pass.ts) and saves a screenshot of
// each at phone (390x844 @3x) and desktop (1512x900) size. It never clicks, types or submits anything: it only loads
// pages, reads where the main content and a real button are, and takes pictures. Started by lib/ad-brain/screens.ts as
// its own process; the server stores the pictures.
//
//   node scripts/ad-brain/capture-screens.mjs <job.json>
//   job.json: { baseUrl, cookie: { name, value }, pages: [{ id, path }], outDir, chromePath?, channel? }
//   writes <outDir>/manifest.json: [{ page, viewport, file, width, height, crop, tap, finalUrl, ok, error }]
//
// Needs playwright-core (in node_modules through @playwright/test) and Google Chrome (or AD_BRAIN_CHROME_PATH).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

/** Words of a real button worth a tap ripple in an ad (read only: the robot never presses it). */
const TAP_WORDS = /approve all|approve|schedule|post now|make an ad|new post/i;

/** Hides things that would cover the page in an ad: the help chat button, toasts, cookie notes (CSS only). */
const HIDE_CSS = `[data-help-chat], [aria-label="Open help chat"], [data-sonner-toaster], .help-chat-launcher { display: none !important; }`;

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const { chromium } = await import("playwright-core");
  mkdirSync(job.outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(job.chromePath ? { executablePath: job.chromePath } : { channel: job.channel || "chrome" }) });
  const host = new URL(job.baseUrl).hostname;
  const out = [];
  try {
    for (const [name, device] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ ...device, colorScheme: "light", locale: "en-GB", timezoneId: "Africa/Kigali" });
      await context.addCookies([{ name: job.cookie.name, value: job.cookie.value, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
      // Nothing may write: every request that is not a read is stopped here too (the proxy refuses them as well).
      await context.route("**/*", (route) => (["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort()));
      const page = await context.newPage();
      for (const p of job.pages) {
        const row = { page: p.id, viewport: name, file: null, width: 0, height: 0, crop: null, tap: null, finalUrl: null, ok: false, error: null };
        try {
          await page.goto(new URL(p.path, job.baseUrl).toString(), { waitUntil: "networkidle", timeout: 45_000 });
          await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
          await page.waitForTimeout(1200);
          row.finalUrl = page.url();
          if (new URL(row.finalUrl).pathname.startsWith("/login")) throw new Error("the pass was not accepted (the page asked to sign in)");
          const info = await page.evaluate((tapSource) => {
            const tapWords = new RegExp(tapSource, "i");
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const main = document.querySelector("main") ?? document.body;
            const r = main.getBoundingClientRect();
            const clamp = (x) => Math.max(0, Math.min(1, x));
            const crop = [clamp(r.left / vw), clamp(r.top / vh), clamp(r.right / vw), clamp(Math.min(r.bottom, vh) / vh)];
            let tap = null;
            for (const b of document.querySelectorAll("button, a[role=button]")) {
              const t = (b.textContent || "").trim();
              const br = b.getBoundingClientRect();
              if (!tapWords.test(t) || br.width < 8 || br.height < 8 || br.bottom > vh || br.top < 0) continue;
              // The button's centre, as a fraction of the cropped area.
              const cx = (br.left + br.width / 2) / vw;
              const cy = (br.top + br.height / 2) / vh;
              tap = [clamp((cx - crop[0]) / (crop[2] - crop[0] || 1)), clamp((cy - crop[1]) / (crop[3] - crop[1] || 1))];
              break;
            }
            return { crop, tap };
          }, TAP_WORDS.source);
          const file = path.join(job.outDir, `${p.id}-${name}.jpg`);
          await page.screenshot({ path: file, type: "jpeg", quality: 88, fullPage: false });
          Object.assign(row, { file, width: device.viewport.width * device.deviceScaleFactor, height: device.viewport.height * device.deviceScaleFactor, crop: info.crop, tap: info.tap, ok: true });
        } catch (e) {
          row.error = String(e instanceof Error ? e.message : e).slice(0, 300);
        }
        out.push(row);
        console.log(JSON.stringify({ page: row.page, viewport: name, ok: row.ok, error: row.error }));
      }
      await context.close();
    }
  } finally {
    await browser.close();
    writeFileSync(path.join(job.outDir, "manifest.json"), JSON.stringify(out, null, 1));
  }
}

if (process.argv[2]) {
  main().catch((e) => {
    console.log(JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }));
    process.exit(1);
  });
}
