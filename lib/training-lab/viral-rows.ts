// A Training Lab reel or video as a viral row (lib/video-engine/brain/viral-ingest.ts ViralVideo), so the viral recipe can
// borrow its techniques beside the curated ones. Only what the example and its notes really say is filled in; the rest
// is neutral. The id is "lab:<example id>". An example the owner rated 1 or 2 stars is not a row (it goes to "avoid").
// Phone numbers and links in the owner's text are swapped for {phone} and {website}. Pure.
import { FORMATS } from "@/lib/video-engine/brain/types";
import { HOOK_IDEAS } from "@/lib/video-engine/brain/viral";
import type { CaptionShape, ViralBeat, ViralNeed, ViralPlatform, ViralRole, ViralVideo } from "@/lib/video-engine/brain/viral-ingest";
import type { ExampleRow } from "./match";
import { scrubContact } from "./scrub";

const PLATFORMS: readonly ViralPlatform[] = ["tiktok", "instagram", "facebook", "youtube"];
const ROLES: readonly ViralRole[] = ["hook", "show", "proof", "offer", "cta"];
const NEEDS: readonly ViralNeed[] = ["photos", "filmed", "person", "ai-ok"];
const HAS_STRENGTH: Record<number, number> = { 3: 0.3, 4: 0.45, 5: 0.6 };
const NEUTRAL_CAPTION: CaptionShape = { lines: 2, chars: 120, hashtags: 3, price: false, phone: false, place: false, delivery: false, dm: false, question: false, emoji: false };

type Notes = Record<string, unknown>;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** Text with phone numbers and links swapped for the placeholders the recipes use. */
const clean = (s: string) => scrubContact(squash(s));
const text = (v: unknown): string => (typeof v === "string" ? clean(v) : Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => clean(x as string)).join(", ") : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) && v.trim() ? Number(v) : null);
/** The first of these keys that has a value ("first_3s", "first3s", "First 3s" are one). */
function pick(notes: Notes, keys: string[]): unknown {
  const flat = new Map(Object.entries(notes).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ""), v]));
  for (const k of keys) {
    const v = flat.get(k.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function beatsOf(notes: Notes, seconds: number, hook: string, good: string): ViralBeat[] {
  const given = pick(notes, ["beats", "shots", "structure"]);
  if (Array.isArray(given)) {
    const beats = given.flatMap((b, i): ViralBeat[] => {
      if (!b || typeof b !== "object") return [];
      const o = b as Notes;
      const from = num(o.from);
      const to = num(o.to);
      if (from === null || to === null || to <= from) return [];
      const role = ROLES.includes(o.role as ViralRole) ? (o.role as ViralRole) : i === 0 ? "hook" : "show";
      return [{ from, to, role, beat: text(o.beat) || role, what: text(o.what) }];
    });
    if (beats.length) return beats;
  }
  // Nothing said about the story: a hook, then the rest.
  const hookEnd = Math.min(3, seconds / 2);
  return [
    { from: 0, to: hookEnd, role: "hook", beat: "Hook", what: hook || good },
    { from: hookEnd, to: seconds, role: "show", beat: "Show", what: good },
  ];
}

/** The example as a viral row, or null when it is not a reel or video, or the owner rated it 1 or 2 stars. */
export function viralRowFromExample(e: ExampleRow): ViralVideo | null {
  if (e.kind !== "reel" && e.kind !== "video") return null;
  if (e.rating !== null && e.rating <= 2) return null;
  const notes: Notes = e.notes && typeof e.notes === "object" && !Array.isArray(e.notes) ? (e.notes as Notes) : {};
  const labels = [...e.technique, ...e.tags].map((t) => t.toLowerCase());
  const seconds = num(pick(notes, ["seconds", "duration", "duration_s", "length"])) ?? 15;
  const cutsPerSecond = num(pick(notes, ["cuts_per_second", "cuts per second"]));
  const cutsPer10s = num(pick(notes, ["cuts_per_10s"])) ?? (cutsPerSecond !== null ? Math.round(cutsPerSecond * 100) / 10 : null);
  const hookType = [pick(notes, ["hook_type"]), ...labels].find((t): t is string => typeof t === "string" && t in HOOK_IDEAS) ?? "curiosity";
  const format = [pick(notes, ["format"]), ...labels].find((t): t is string => typeof t === "string" && (FORMATS as readonly string[]).includes(t)) ?? "product-reveal";
  const platform = [pick(notes, ["platform"]), ...labels].find((t): t is string => typeof t === "string" && PLATFORMS.includes(t as ViralPlatform)) as ViralPlatform | undefined;
  const hook = text(pick(notes, ["hook", "hook_text"]));
  const good = clean(e.whatIsGood);
  const needsGiven = pick(notes, ["needs"]);
  const needs: ViralNeed[] = Array.isArray(needsGiven) && needsGiven.every((n) => NEEDS.includes(n as ViralNeed)) && needsGiven.length ? (needsGiven as ViralNeed[]) : pick(notes, ["person", "presenter"]) === true ? ["filmed", "person"] : ["filmed"];
  const is = (keys: string[]) => pick(notes, keys) === true;
  const language = e.language?.trim() || null;
  const country = /^[A-Z]{2}$/.test(String(pick(notes, ["country"]) ?? "")) ? String(pick(notes, ["country"])) : language?.toLowerCase() === "kinyarwanda" ? "RW" : null;
  return {
    id: `lab:${e.id}`,
    platform: platform ?? "instagram",
    country,
    city: null,
    region: country && ["RW", "KE", "UG", "TZ", "BI", "CD", "SS", "ET"].includes(country) ? "east-africa" : "global",
    sector: e.sector?.trim().toLowerCase() || "shop",
    kind: "business",
    isAd: is(["is_ad", "ad"]),
    format,
    hookType,
    seconds,
    language,
    strength: HAS_STRENGTH[e.rating ?? 3] ?? 0.3,
    reach: e.rating ? `an example you rated ${e.rating} of 5 stars` : "an example from your Training Lab",
    hook,
    first3s: text(pick(notes, ["first_3s", "first3s", "opening"])) || hook || good,
    beats: beatsOf(notes, seconds, hook, good),
    cutsPer10s,
    camera: text(pick(notes, ["camera", "camera_moves"])),
    look: text(pick(notes, ["look", "visual_style", "grade"])),
    textStyle: text(pick(notes, ["text_style", "stickers", "captions"])),
    textPatterns: [...new Set((Array.isArray(pick(notes, ["on_screen_text"])) ? (pick(notes, ["on_screen_text"]) as unknown[]) : []).map(text).filter((t) => t && t.length <= 80))].slice(0, 6),
    priceShown: is(["price_shown"]),
    phoneShown: is(["phone_shown"]),
    locationShown: is(["location_shown"]),
    cta: text(pick(notes, ["cta", "call_to_action"])),
    loop: is(["loop", "loops"]),
    voice: text(pick(notes, ["voice", "voice_over"])),
    music: text(pick(notes, ["music", "music_mood", "beat_sync"])),
    why: good,
    lesson: good,
    caption: NEUTRAL_CAPTION,
    needs,
    group: `lab:${e.id}`,
  };
}

/** The Lab rows for a recipe: every usable reel or video example, as a viral row. */
export const viralRowsFrom = (examples: readonly ExampleRow[]): ViralVideo[] => examples.flatMap((e) => viralRowFromExample(e) ?? []);
