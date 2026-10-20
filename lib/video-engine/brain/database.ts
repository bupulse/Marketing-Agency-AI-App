// The brain's database, loaded with its types (index.ts checks it; select.ts, score.ts and outcomes.ts read it). Kept
// apart from index.ts so the modules that read the data at load time never import the index that re-exports them.
import captionsJson from "./data/captions.json";
import evidenceJson from "./data/evidence.json";
import formatsJson from "./data/formats.json";
import hooksJson from "./data/hooks.json";
import rulesJson from "./data/rules.json";
import sectorsJson from "./data/sectors.json";
import type { BrainData, CaptionsData, Evidence, Format, FormatId, Hook, Rule, Sector } from "./types";

export const BRAIN: BrainData = {
  evidence: evidenceJson as Evidence[],
  hooks: hooksJson as Hook[],
  formats: formatsJson as Format[],
  captions: captionsJson as CaptionsData,
  rules: rulesJson as Rule[],
  sectors: sectorsJson as Sector[],
};

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
const HOOKS = byId(BRAIN.hooks);
const FORMAT_MAP = byId(BRAIN.formats);
const SECTOR_MAP = byId(BRAIN.sectors);
const EVIDENCE = byId(BRAIN.evidence);

export const hookById = (id: string): Hook | null => HOOKS.get(id) ?? null;
export const formatById = (id: string | null | undefined): Format | null => (id ? (FORMAT_MAP.get(id) ?? null) : null);
export const sectorById = (id: string | null | undefined): Sector | null => (id ? (SECTOR_MAP.get(id) ?? null) : null);
export const evidenceById = (id: string): Evidence | null => EVIDENCE.get(id) ?? null;

/** A box of the frame, as fractions of the canvas: text must sit between top and bottom, left and right. */
export type SafeArea = { top: number; bottom: number; left: number; right: number };
/**
 * The text area each platform leaves free on a vertical video (9:16, 3:4, 4:5), from designer.ts PLATFORMS and the
 * research: TikTok and Instagram cover the bottom 20% and the right 15% (instagram-patterns.md), Shorts the top 10% (auto
 * captions) and the bottom 25%, Facebook the bottom 15%. "youtube" (designer.ts's key) is the same as "shorts"; "any" is
 * the designer's default when no platform is given.
 */
export const SAFE_AREAS: Record<"tiktok" | "instagram" | "facebook" | "shorts" | "youtube" | "any", SafeArea> = {
  tiktok: { top: 0.12, bottom: 0.78, left: 0.07, right: 0.85 },
  instagram: { top: 0.12, bottom: 0.78, left: 0.07, right: 0.85 },
  facebook: { top: 0.08, bottom: 0.85, left: 0.07, right: 0.93 },
  shorts: { top: 0.1, bottom: 0.75, left: 0.07, right: 0.85 },
  youtube: { top: 0.1, bottom: 0.75, left: 0.07, right: 0.85 },
  any: { top: 0.12, bottom: 0.82, left: 0.07, right: 0.93 },
};
/** The safe area for a platform key (brain or designer.ts); unknown or missing keys get the default ("any"). */
export const safeAreaFor = (platform: string | null | undefined): SafeArea => SAFE_AREAS[(platform ?? "any") as keyof typeof SAFE_AREAS] ?? SAFE_AREAS.any;

/** The format that makes a Claude engine template (templates.ts id), or null. */
export function formatForTemplate(templateId: string | null | undefined): FormatId | null {
  if (!templateId) return null;
  return BRAIN.formats.find((f) => f.claudeTemplates.includes(templateId))?.id ?? null;
}
