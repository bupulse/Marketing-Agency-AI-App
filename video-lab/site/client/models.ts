// The studio's models (video-lab/site/models.json), shared by the home cards, the model pages, the image page and the
// API page: their credit prices from /api/pricing, and the example prompts that open the right generator.
import list from "../models.json";
import { api, el } from "./site";

export type Model = { id: string; group: "video" | "motion" | "image"; route: string; engine: "seedance" | "claude" | "gemini"; tier: "pro" | "fast" | "mini" | null; soon?: boolean; name: string; tag: string; tagline: string; blurb: string; goodAt: string[]; examples: string[]; featureCategory?: string };
export const MODELS = list as Model[];
export const modelById = (id: string | undefined) => MODELS.find((m) => m.id === id);

export type Pricing = {
  packs: { id: string; name: string; credits: number; rwf: number; blurb: string; popular?: boolean }[];
  seedance: { tier: string; name: string; resolution: string; credits5s: number; credits10s: number; credits15s: number }[];
  claudeCredits: number;
  presenterCredits: number;
  voiceCredits?: number;
  premium3dCredits?: number;
};

/** "55 to 120 credits per 5 s", "30 credits a video", "15 credits an image". */
export function creditsLabel(m: Model, p: Pricing): string {
  if (m.soon) return "Price set when it arrives";
  if (m.engine === "claude") return `${p.claudeCredits} credits a video`;
  if (m.engine === "gemini") return `${p.presenterCredits} credits an image`;
  const rows = p.seedance.filter((r) => r.tier === m.tier).map((r) => r.credits5s);
  if (!rows.length) return "";
  const [lo, hi] = [Math.min(...rows), Math.max(...rows)];
  return lo === hi ? `${lo} credits per 5 s` : `${lo} to ${hi} credits per 5 s (by resolution)`;
}

/** Fills every [data-credits-for] on the page, and the API page's rate table. */
export function fillCredits(p: Pricing): void {
  document.querySelectorAll<HTMLElement>("[data-credits-for]").forEach((node) => {
    const m = modelById(node.dataset.creditsFor);
    if (m) node.textContent = creditsLabel(m, p);
  });
  const t = document.getElementById("apiRates");
  if (t) {
    t.replaceChildren(el("tr", {}, ...["Model", "Credits"].map((h) => el("th", { textContent: h }))));
    for (const m of MODELS) t.append(el("tr", {}, el("td", { textContent: m.name }), el("td", { textContent: creditsLabel(m, p) })));
  }
}

/**
 * Example prompt buttons: on a page with a prompt box they fill it (onUse); elsewhere they open the generator named in
 * data-target with the prompt in the address.
 */
export function wireExamples(onUse?: (text: string) => void): void {
  document.querySelectorAll<HTMLButtonElement>("[data-example]").forEach((b) => {
    b.onclick = () => {
      const text = b.dataset.example ?? "";
      if (onUse && (!b.dataset.target || b.dataset.target === location.pathname)) return onUse(text);
      // The studio is a plain site, not Next.js: a normal page change is right here.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.href = `${b.dataset.target ?? "/create"}?prompt=${encodeURIComponent(text)}`;
    };
  });
}

export async function loadPricing(): Promise<Pricing> {
  const p = await api<Pricing>("/api/pricing");
  fillCredits(p);
  return p;
}
