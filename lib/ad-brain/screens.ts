// The screen robot's server side (docs/AD_BRAIN.md, section 7): makes the 5-minute read-only pass for the BuPulse
// company account, runs scripts/ad-brain/capture-screens.mjs (headless Chrome, its own process) against this server's
// own address, and stores each picture as an Ad Brain asset of kind "screen" with its capture date, page, size, the
// main content's crop, a real button's position for the tap ripple, and how much data the page had (an empty page is
// never shown in an ad). Captures are refreshed when the newest is 24 hours old, or from Admin -> Ad Brain.
import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { AdBrainSetupError, companyAccount } from "./facts";
import { isEmptyPage, pagesToCapture, screensStale, type PageCounts, type ScreenPageId } from "./screen-plan";
import { SCREEN_PASS_COOKIE, screenPassSecret, signScreenPass } from "./screen-pass";
import { jobDir } from "./render";
import { assetHash, saveAsset } from "./store";

/** This server's own address, which the robot opens (never the public site: the pass works only from this computer). */
export const selfUrl = (env: Record<string, string | undefined> = process.env) => env.AD_BRAIN_SELF_URL?.trim() || `http://127.0.0.1:${env.PORT?.trim() || "3002"}`;

/** How much real data each page has right now (what "empty" means for it). */
export async function pageCounts(businessId: string, now = new Date()): Promise<PageCounts> {
  const day = 86_400_000;
  const [posts, calendar, autopilot, designs, photos, leads] = await Promise.all([
    prisma.post.count({ where: { businessId, status: { notIn: ["CANCELLED", "EXPIRED"] }, createdAt: { gte: new Date(now.getTime() - 30 * day) } } }),
    prisma.post.count({ where: { businessId, status: { in: ["SCHEDULED", "PUBLISHED", "PENDING_APPROVAL"] }, scheduledAt: { gte: new Date(now.getTime() - 14 * day), lte: new Date(now.getTime() + 14 * day) } } }),
    prisma.autopilotSettings.count({ where: { businessId, enabled: true } }),
    prisma.design.count({ where: { businessId } }),
    prisma.mediaAsset.count({ where: { businessId, kind: "photo" } }),
    prisma.lead.count({ where: { businessId } }),
  ]);
  return { home: 1, posts, calendar, autopilot, designs, photos, leads };
}

/** When the newest robot capture was taken, or null. */
export async function newestCaptureAt(): Promise<Date | null> {
  const row = await prisma.adAsset.findFirst({ where: { kind: "screen", provider: "robot" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return row?.createdAt ?? null;
}

type ManifestRow = { page: ScreenPageId; viewport: "phone" | "desktop"; file: string | null; width: number; height: number; crop: [number, number, number, number] | null; tap: [number, number] | null; finalUrl: string | null; ok: boolean; error: string | null };

function runCapture(jobPath: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "ad-brain", "capture-screens.mjs");
  return new Promise((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ process.execPath, [script, jobPath], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: process.env });
    let out = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: `${out}${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out });
    });
  });
}

export type CaptureResult = { captured: number; failed: number; skippedEmpty: number; errors: string[] };

/**
 * Takes every page again (`force`), or only when the captures are 24 hours old. Throws in plain English when Chrome
 * cannot run or the pass is refused.
 */
export async function captureScreens(opts: { force?: boolean; now?: Date } = {}): Promise<CaptureResult | null> {
  const now = opts.now ?? new Date();
  if (!opts.force && !screensStale(await newestCaptureAt(), now)) return null;
  const account = await companyAccount();
  const counts = await pageCounts(account.businessId, now);
  const pages = pagesToCapture(counts);
  const token = await signScreenPass({ userId: account.userId, businessId: account.businessId, now: now.getTime() }, screenPassSecret());
  const dir = path.join(/*turbopackIgnore: true*/ jobDir("screens"), String(now.getTime()));
  await fs.mkdir(dir, { recursive: true });
  const jobPath = path.join(/*turbopackIgnore: true*/ dir, "job.json");
  const chromePath = process.env.AD_BRAIN_CHROME_PATH?.trim();
  await fs.writeFile(jobPath, JSON.stringify({ baseUrl: selfUrl(), cookie: { name: SCREEN_PASS_COOKIE, value: token }, pages: pages.map((p) => ({ id: p.id, path: p.path })), outDir: dir, ...(chromePath ? { chromePath } : { channel: "chrome" }) }));
  try {
    const run = await runCapture(jobPath, 4 * 60_000);
    const manifest = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ dir, "manifest.json"), "utf8").catch(() => "[]")) as ManifestRow[];
    if (!manifest.length) throw new AdBrainSetupError(run.out.includes("Executable") || run.out.includes("chrome") ? "Google Chrome could not start for the screen robot. Install it on the server (docs/SELF_HOST.md) or set AD_BRAIN_CHROME_PATH." : `The screen robot did not run (${run.out.trim().split(/\r?\n/).pop()?.slice(0, 200) || `code ${run.code}`}).`);
    const result: CaptureResult = { captured: 0, failed: 0, skippedEmpty: 0, errors: [] };
    const capturedAt = now.toISOString();
    for (const row of manifest) {
      if (!row.ok || !row.file) {
        result.failed += 1;
        if (row.error) result.errors.push(`${row.page} (${row.viewport}): ${row.error}`);
        continue;
      }
      const empty = isEmptyPage(row.page, counts);
      if (empty) result.skippedEmpty += 1;
      const label = pages.find((p) => p.id === row.page)?.label ?? row.page;
      await saveAsset({
        hash: assetHash({ kind: "screen", page: row.page, viewport: row.viewport, capturedAt }),
        kind: "screen",
        provider: "robot",
        bytes: await fs.readFile(row.file),
        mimeType: "image/jpeg",
        meta: { key: `${row.page}-${row.viewport}`, page: label, pageId: row.page, viewport: row.viewport, label: `${label} (${row.viewport})`, capturedAt, crop: row.crop ?? undefined, tap: row.tap ?? undefined, items: counts[row.page], empty, width: row.width, height: row.height },
      });
      result.captured += 1;
    }
    // Every page failing to load means the pass was refused or the server's address is wrong: say so.
    if (result.captured === 0) throw new AdBrainSetupError(`No page could be captured: ${result.errors[0] ?? "unknown reason"}. Check AD_BRAIN_SELF_URL (this server's own address).`);
    return result;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Before an ad: fresh captures when they are 24 hours old. A failed refresh keeps the last ones (logged). */
export async function refreshScreensIfStale(): Promise<{ note: string } | null> {
  try {
    const r = await captureScreens({ force: false });
    return r ? { note: `Real screens captured again: ${r.captured} pictures${r.skippedEmpty ? `, ${r.skippedEmpty} of empty pages kept out of ads` : ""}${r.failed ? `, ${r.failed} failed` : ""}.` } : null;
  } catch (error) {
    await logError(error, { source: "adBrain.screens", level: "warn" }).catch(() => undefined);
    return { note: `The real screens could not be captured again (${error instanceof Error ? error.message : "unknown"}); the last captures are used.` };
  }
}
