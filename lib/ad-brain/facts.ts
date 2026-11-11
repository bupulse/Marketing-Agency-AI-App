// What the Ad Brain knows about BuPulse (owner decision, 10 November 2026: the Ad Brain markets BuPulse only, from the
// BuPulse company account and its real data). The brand brief may only claim what is here (hard rule 4): the company
// account's Business info and products, BuPulse's built features (lib/features.ts) and its sellable plans
// (lib/plan-catalog.ts), and the real screen captures it may show (hard rule 1).
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { getSellablePlans } from "@/lib/plan-catalog";
import { fixtureWordFiles } from "./fixtures";
import type { BrandInfo, ScreenCapture } from "./plan";
import { assetHash, findAsset, fixtureDir, saveAsset } from "./store";

/** The BuPulse company account (AD_BRAIN_COMPANY_EMAIL, else office@bupulse.com). */
export const companyEmail = () => (process.env.AD_BRAIN_COMPANY_EMAIL?.trim() || "office@bupulse.com").toLowerCase();

export class AdBrainSetupError extends Error {}

export async function companyAccount(): Promise<{ userId: string; businessId: string; name: string; timezone: string }> {
  const user = await prisma.user.findUnique({ where: { email: companyEmail() }, select: { id: true, business: { select: { id: true, name: true, timezone: true } } } });
  if (!user?.business) throw new AdBrainSetupError(`The BuPulse company account (${companyEmail()}) has no business on this database yet. Sign it up first.`);
  return { userId: user.id, businessId: user.business.id, name: user.business.name, timezone: user.business.timezone };
}

/** BuPulse's brand: the site, Pulse Blue and Pulse Violet (docs/handovers/video-engine-map.md), the app icon. */
export const BUPULSE_BRAND: BrandInfo = { name: "BuPulse", url: "bupulse.com", primary: "#2f6bff", accent: "#7b5cff", logoRef: "repo:public/icon.png" };

export type Facts = { text: string; brand: BrandInfo; screens: ScreenCapture[]; recentPosts: string[] };

const line = (s: string | null | undefined, max = 400) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Everything the brand brief may use, as text for the brain, plus the real screens. */
export async function loadFacts(businessId: string): Promise<Facts> {
  const [business, products, posts, plans, screens] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true, description: true, audience: true, website: true, industryDescription: true, profile: true, positioning: true } }),
    prisma.product.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 8, select: { name: true, summary: true, usps: true, features: true } }),
    prisma.post.findMany({ where: { businessId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 5, select: { text: true } }),
    getSellablePlans().catch(() => []),
    listScreens(),
  ]);
  const features = FEATURES.filter((f) => f.status === "built" && f.kind === "app").map((f) => `- ${f.label}: ${line(f.description, 200)}`);
  const text = [
    "PRODUCT: BuPulse, an AI marketing app for small businesses (bupulse.com), launching in Rwanda first.",
    "BUILT FEATURES (true today):",
    ...features,
    plans.length ? "PLANS (names and what they include; do not quote prices: people ask for a free quote):" : "",
    ...plans.map((p) => `- ${p.name}: ${line(p.description, 160)}${p.highlights.length ? ` (${p.highlights.slice(0, 5).map((h) => line(h, 80)).join("; ")})` : ""}`),
    "CALL TO ACTION: go to bupulse.com and ask for a free quote; BuPulse calls back; Mobile Money or card.",
    business ? `COMPANY ACCOUNT BUSINESS INFO (${line(business.name, 80)}): ${line(business.description || business.industryDescription, 500)}${business.audience ? ` Audience: ${line(business.audience, 300)}` : ""}` : "",
    ...products.map((p) => `- Product ${line(p.name, 80)}: ${line(p.summary, 200)}${p.usps.length ? ` Why: ${p.usps.slice(0, 4).join("; ")}` : ""}`),
  ].filter(Boolean);
  return { text: text.join("\n").slice(0, 8000), brand: BUPULSE_BRAND, screens, recentPosts: posts.map((p) => line(p.text, 200)) };
}

/** The real screen captures the ads may show (AdAsset rows of kind "screen"), newest first. */
export async function listScreens(): Promise<ScreenCapture[]> {
  const rows = await prisma.adAsset.findMany({ where: { kind: "screen" }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, meta: true, createdAt: true } });
  return rows.map((r) => {
    const m = (r.meta ?? {}) as { page?: string; label?: string; capturedAt?: string; crop?: [number, number, number, number]; tap?: [number, number]; key?: string };
    return { id: m.key ?? r.id, page: m.page ?? "Dashboard", label: m.label ?? m.page ?? "Dashboard", capturedAt: m.capturedAt ?? r.createdAt.toISOString().slice(0, 10), ref: `ad:${r.id}`, ...(m.crop ? { crop: m.crop } : {}), ...(m.tap ? { tap: m.tap } : {}) };
  });
}

/**
 * Loads the real dashboard captures from the 10 Nov 2026 prototype folder (the BuPulse account's own pages) into the
 * screen cache, until the screen robot (phase 2) captures them itself. Free. Returns how many were added.
 */
export async function seedPrototypeScreens(jobId: string | null = null): Promise<number> {
  const { twistFixture } = await import("./fixtures");
  const edl = twistFixture();
  const labels: Record<string, string> = {};
  for (const s of edl.segments) if (s.source === "real_screen" && s.asset && s.tags?.title) labels[s.asset] = s.tags.title;
  let added = 0;
  for (const [key, a] of Object.entries(edl.assets)) {
    if (a.kind !== "screen" || !a.ref.startsWith("fixture:")) continue;
    const file = path.join(/*turbopackIgnore: true*/ fixtureDir(), a.ref.slice(8));
    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes) throw new AdBrainSetupError(`The prototype captures are not on this computer (${fixtureDir()}).`);
    const id = key.replace(/^screen:/, "");
    const hash = assetHash({ kind: "screen", file: a.ref, crop: a.crop ?? null });
    if (await findAsset(hash)) continue;
    await saveAsset({ hash, jobId, kind: "screen", provider: "upload", bytes, mimeType: "image/jpeg", meta: { key: id, page: a.capture?.page, label: labels[key] ?? a.capture?.page, capturedAt: a.capture?.capturedAt, crop: a.crop, tap: a.tap } });
    added += 1;
  }
  return added;
}

/** The fixture's word timings (from its folder), for a fixture job. */
export async function fixtureWords(): Promise<Record<string, { w: string; s: number; e: number }[]>> {
  const out: Record<string, { w: string; s: number; e: number }[]> = {};
  for (const [key, rel] of Object.entries(fixtureWordFiles)) {
    const text = await fs.readFile(path.join(/*turbopackIgnore: true*/ fixtureDir(), rel), "utf8").catch(() => null);
    if (text) out[key] = (JSON.parse(text) as { words: { w: string; s: number; e: number }[] }).words;
  }
  return out;
}
