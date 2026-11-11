// UGC ad variants (owner, 11 Nov 2026): several versions of one concept on the same body, e.g. 3 hooks x 2 CTAs.
// Only the hook line (the first spoken line) and the spoken CTA change, so every other picture and clip is reused from
// the cache (store.ts, by hash) and a variant costs about one hook clip and one CTA line. Each variant is its own AdJob
// (variantOf = the ad), made one after another. Pure.

import { carriesCta, CTAS, type Cta } from "./ctas";
import type { Recipe } from "./recipes";
import type { Script } from "./script-rules";

export type VariantSpec = { hooks: number; ctas: number };
/** At most 3 hooks and 2 CTAs, and never more than 5 extra videos for one ad. */
export const VARIANT_LIMITS = { hooks: 3, ctas: 2, total: 5 } as const;

export const cleanVariantSpec = (v: unknown): VariantSpec | null => {
  const o = (v ?? {}) as { hooks?: unknown; ctas?: unknown };
  const hooks = Math.max(1, Math.min(VARIANT_LIMITS.hooks, Math.floor(Number(o.hooks) || 1)));
  const ctas = Math.max(1, Math.min(VARIANT_LIMITS.ctas, Math.floor(Number(o.ctas) || 1)));
  return hooks * ctas > 1 ? { hooks, ctas } : null;
};

/** The beat whose line is the hook: the recipe's first beat with a spoken line. */
export const hookBeatOf = (recipe: Recipe) => recipe.beats.find((b) => b.speech === "line")?.id ?? null;

/** Other CTAs for the variants: not the ad's own, of a tone that fits the ad's (content keeps to soft ones). */
export function alternativeCtas(own: Cta | undefined, count: number, kind: "ad" | "content"): Cta[] {
  return CTAS.filter((c) => c.id !== own?.id && (kind === "ad" || c.tone === "soft")).slice(0, Math.max(0, count));
}

export type PlannedVariant = { label: string; hook: number; cta: number; script: Script; ctaId: string | null };

/**
 * The variants of an ad: every combination of its hooks (its own first, then `hooks`) and CTAs (its own first, then
 * `ctas`) except its own, at most VARIANT_LIMITS.total. Each is the ad's script with only the hook line and the spoken
 * CTA replaced; the speaker and source stay (a money word in AI speech falls back to a voice-over by itself).
 */
export function planVariants(input: { script: Script; recipe: Recipe; spec: VariantSpec; hooks: readonly string[]; ownCta?: Cta; ctas: readonly Cta[] }): PlannedVariant[] {
  const hookBeat = hookBeatOf(input.recipe);
  const ownHook = input.script.beats.find((b) => b.beat === hookBeat)?.line?.text ?? "";
  const hookTexts = [ownHook, ...input.hooks.map((h) => h.replace(/\s+/g, " ").trim()).filter((h) => h && h !== ownHook)].slice(0, input.spec.hooks);
  const ctaOptions: (Cta | null)[] = [input.ownCta ?? null, ...input.ctas.filter((c) => c.id !== input.ownCta?.id)].slice(0, input.spec.ctas);
  const out: PlannedVariant[] = [];
  for (let h = 0; h < hookTexts.length; h++) {
    for (let c = 0; c < ctaOptions.length; c++) {
      if (h === 0 && c === 0) continue;
      if (out.length >= VARIANT_LIMITS.total) return out;
      const cta = ctaOptions[c];
      const script: Script = {
        ...input.script,
        beats: input.script.beats.map((b) => (b.beat === hookBeat && b.line && h > 0 ? { ...b, line: { ...b.line, text: hookTexts[h] } } : b)),
        cta: c > 0 && cta && !carriesCta(input.script.cta.text, cta) ? { ...input.script.cta, text: cta.spoken } : input.script.cta,
      };
      out.push({ label: `hook ${h + 1} · CTA ${c + 1}`, hook: h, cta: c, script, ctaId: cta?.id ?? null });
    }
  }
  return out;
}
