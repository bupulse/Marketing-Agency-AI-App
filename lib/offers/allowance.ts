// The monthly AI allowance of a custom plan (docs/CONTENT_VISUALS.md): its base plan's allowance plus what its image
// packs need, so a paid pack is always usable; without a base plan, enough for its AI images. Pure.
import { derivedAllowanceUsd, packAllowanceUsd } from "@/lib/ai/budget";

/** Image packs (`block:image` lines) in an offer's lines. */
export function imagePacks(lines: unknown): number {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((sum, l) => sum + (l && typeof l === "object" && (l as { key?: unknown }).key === "block:image" ? Math.max(0, Number((l as { quantity?: unknown }).quantity) || 0) : 0), 0);
}

export function customAllowanceUsd(input: { baseUsd?: number | null; lines: unknown; limits: unknown }): number {
  const packs = imagePacks(input.lines);
  if (typeof input.baseUsd === "number" && input.baseUsd >= 0) return input.baseUsd + packAllowanceUsd(packs);
  const images = Number((input.limits as { image?: unknown } | null)?.image);
  return derivedAllowanceUsd(Number.isFinite(images) ? images : 0);
}
