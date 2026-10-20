// Seedance "Get inspired" examples (docs/VIDEO_ENGINE.md, "Example storyboards"): storyboards made from the TEST
// database's real products with the Seedance brain (planSeedanceShots + the storyboard renderer). No key, no Claude,
// no cost; nothing beyond the products' own facts. Made by scripts/video-lab/seedance-examples.mjs, read by
// listSeedanceExamples() in preview.ts.
import fs from "node:fs/promises";
import path from "node:path";
import { SEEDANCE_MODELS, type SeedanceTier } from "@/lib/video-engine/seedance";
import { detectBusinessKind, planSeedanceShots, type BusinessKind, type SeedanceFormat } from "@/lib/video-engine/seedance-brain";
import { seedanceCredits } from "../credits";
import { getBusiness, listBusinesses, listProducts, photoJpeg, type LabBusinessDetail, type LabProduct } from "../data-source";
import { buildStoryboard, type Storyboard } from "./storyboard";
import { previewThumbs } from "./preview";

export { closeDb } from "../data-source";

export const EXAMPLES_DIR = path.resolve("video-lab/seedance-mock/examples");
/** Git-ignored: businesses (by name) never used for examples, one per line, e.g. real companies in the TEST database. */
export const SKIP_FILE = path.resolve("video-lab/data/seedance-examples-skip.txt");

export async function readExampleSkips(file = SKIP_FILE): Promise<string[]> {
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Empties the examples folder, so a business left out (or a product removed) leaves no old file behind. */
export async function clearExamples(dir = EXAMPLES_DIR): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

export type SeedanceExample = {
  id: string;
  /** Gallery order: sectors take turns, so neighbours differ. */
  order: number;
  title: string;
  sector: BusinessKind;
  format: SeedanceFormat;
  templateId: string;
  seconds: number;
  ratio: string;
  prompt: string;
  notes: string[];
  storyboard: Storyboard;
  /** What the real clip would cost, per quality, at the resolutions each one makes. */
  credits: { tier: SeedanceTier; name: string; resolution: string; credits: number }[];
  source: { businessId: string; businessName: string; productId: string; productName: string };
};

export type Candidate = { business: LabBusinessDetail; product: LabProduct; kind: BusinessKind };

export async function loadCandidates(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const b of await listBusinesses()) {
    const business = await getBusiness(b.id);
    if (!business) continue;
    for (const product of await listProducts(b.id)) out.push({ business, product, kind: detectBusinessKind({ business, product }) });
  }
  return out;
}

/** The format each sector shows best first, then the others, so the gallery covers every format. */
const FORMATS_BY_KIND: Record<BusinessKind, SeedanceFormat[]> = {
  shop: ["product-reveal", "offer", "ugc-testimonial", "unboxing"],
  restaurant: ["product-reveal", "tour", "ugc-testimonial", "offer"],
  salon: ["before-after", "tour"],
  "phone-shop": ["unboxing", "product-reveal", "ugc-testimonial", "offer"],
  "real-estate": ["tour", "product-reveal"],
  fashion: ["product-reveal", "before-after", "ugc-testimonial"],
  events: ["offer", "tour"],
  services: ["before-after", "tour", "ugc-testimonial"],
  education: ["ugc-testimonial", "tour"],
};
const SECONDS: Record<SeedanceFormat, number> = { "product-reveal": 8, "ugc-testimonial": 10, "before-after": 10, unboxing: 10, tour: 12, offer: 8 };

/**
 * Picks 12 to 16 (product, format) pairs: round-robin over the sectors present, one product per example where
 * possible, products with photos first, each sector cycling through its formats.
 */
export function pickExamples(candidates: Candidate[], max = 16): { c: Candidate; format: SeedanceFormat }[] {
  const byKind = new Map<BusinessKind, Candidate[]>();
  for (const c of [...candidates].sort((a, b) => b.product.photos.length - a.product.photos.length)) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const picks: { c: Candidate; format: SeedanceFormat }[] = [];
  const used = new Set<string>();
  for (let round = 0; picks.length < max; round++) {
    let added = false;
    for (const [kind, list] of byKind) {
      const formats = FORMATS_BY_KIND[kind];
      if (round >= formats.length || picks.length >= max) continue;
      const c = list.find((x) => !used.has(x.product.id)) ?? list[round % list.length];
      used.add(c.product.id);
      picks.push({ c, format: formats[round] });
      added = true;
    }
    if (!added) break;
  }
  return picks;
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export async function makeExample({ c, format }: { c: Candidate; format: SeedanceFormat }, order = 0): Promise<SeedanceExample> {
  const { business, product, kind } = c;
  const photos = product.photos.slice(0, 2);
  const references = photos.map((p, i) => `Image ${i + 1}: ${p.description?.trim() || `photo of ${product.name}`}`);
  const plan = planSeedanceShots({
    business: { name: business.name, description: business.description, language: business.language, country: business.country },
    product: { name: product.name, summary: product.summary, description: product.description, price: product.price, usps: product.usps, features: product.features },
    references,
    businessKind: kind,
    format,
    seconds: SECONDS[format],
    ratio: "9:16",
    audio: true,
  });
  const images = await Promise.all(photos.map(async (p) => `data:image/jpeg;base64,${(await photoJpeg(p.assetId, 480, business.id)).bytes.toString("base64")}`));
  const id = `ex-${slug(kind)}-${slug(format)}-${slug(product.name)}`;
  const request = { tier: "fast" as const, prompt: plan.prompt, references: images.map((url) => ({ kind: "image" as const, url })), ratio: "9:16" as const, seconds: plan.seconds, resolution: "720p" as const, audio: true, fixedLens: false, seed: null };
  const storyboard = buildStoryboard({ id, title: `${product.name}: ${plan.templateName}`, request, referenceNotes: references, thumbs: await previewThumbs(request.references), credits: seedanceCredits("fast", "720p", plan.seconds) });
  const credits = (Object.keys(SEEDANCE_MODELS) as SeedanceTier[]).flatMap((tier) => SEEDANCE_MODELS[tier].resolutions.map((resolution) => ({ tier, name: SEEDANCE_MODELS[tier].name, resolution, credits: seedanceCredits(tier, resolution, plan.seconds) })));
  return {
    id,
    order,
    title: `${plan.templateName}: ${product.name}`,
    sector: kind,
    format: plan.format,
    templateId: plan.templateId,
    seconds: plan.seconds,
    ratio: plan.ratio,
    prompt: plan.prompt,
    notes: plan.notes,
    storyboard,
    credits,
    source: { businessId: business.id, businessName: business.name, productId: product.id, productName: product.name },
  };
}

/** Rebuilds the examples folder from the TEST database, leaving out businesses whose name contains a `skip` text. */
export async function writeSeedanceExamples(max = 16, skip: string[] = []): Promise<SeedanceExample[]> {
  const examples: SeedanceExample[] = [];
  const candidates = (await loadCandidates()).filter((c) => !skip.some((s) => c.business.name.toLowerCase().includes(s.toLowerCase())));
  for (const [i, pick] of pickExamples(candidates, max).entries()) examples.push(await makeExample(pick, i));
  await clearExamples();
  for (const e of examples) await fs.writeFile(path.join(EXAMPLES_DIR, `${e.id}.json`), JSON.stringify(e, null, 1));
  return examples;
}
