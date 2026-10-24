// The reel Director's taste from the Training Lab (lib/reel-engine/story.ts directMontage): which of its own variants
// and camera moves the owner's examples point to. An example rated 4 or 5 stars makes what its techniques, tags and
// notes name preferred; a "never this" note naming one makes it avoided (avoid wins). Matching is by keyword on the
// Director's own ids; words it does not know are ignored. Pure.
import { REEL_CAMERAS } from "@/lib/reel-engine/story";

/** The examples' fields the mapping reads (a TrainingExample row or match.ts ExampleRow). */
export type DirectorExample = { technique: string[]; tags: string[]; notes: unknown; rating: number | null; neverThis: string | null };
export type DirectorTaste = { prefer: string[]; avoid: string[] };

/** The Director's variant keys ("beat:variant") and the words that name each. */
const VARIANT_WORDS: Record<string, RegExp> = {
  "hook:walk-up": /\bwalk[- ]?ups?\b|\bwalks? (up|towards?|to the camera)\b/,
  "hook:struggle": /\bstruggl|\bmishap|\bcomedy\b|\bskit\b/,
  "hook:question": /\bquestion hook\b|\basks? (a|the) question\b|\bquestion to camera\b/,
  "hook:reveal": /\breveal\b|\bunveil|\bcloth (off|reveal)|\bpulls? (a|the) cloth\b/,
  "use:demo": /\bdemo\b|\bdemonstrat|\bshows? how\b/,
  "use:walkthrough": /\bwalk[- ]?through\b|\bwalks? around\b|\btour\b/,
  "use:customer-try": /\bcustomer tr(y|ies)|\bfirst try\b|\btries it\b/,
  "use:working": /\bin action\b|\bvoice[- ]?over\b|\bworking shot\b/,
  "result:reaction": /\breaction\b|\breacts?\b/,
  "result:before-after": /\bbefore[- ](and[- ])?after\b/,
  "result:family": /\bfamily\b|\bteam enjoys?\b/,
  "cta:comment": /\bcomment\b|\bdm\b|\bsend a message\b/,
  "cta:point": /\bpoints? (at|to)\b|\bpointing\b/,
  "cta:shop": /\bvisit (us|the shop)\b|\bcome to (the )?(shop|store)\b|\bshop ?front\b/,
  "cta:hand-over": /\bhands? (it )?over\b|\bhand[- ]?over\b/,
  "broll:spin": /\bspin\b|\b360\b|\bdutch angle\b|\bcircles? (fast )?around\b/,
  "broll:low-reveal": /\blow[- ]?(angle )?reveal\b|\bfrom the ground\b/,
  "broll:detail": /\bdetail\b|\bclose[- ]?ups?\b|\bmacro\b/,
  "broll:in-place": /\bwhip[- ]?pan\b|\bin (its|the) real place\b/,
  "broll:result": /\bresult shot\b|\bfinished look\b|\bfresh result\b/,
};

/** REEL_CAMERAS, in order, and the words that name each move. */
const CAMERA_WORDS: RegExp[] = [
  /\bwalk(s|ing)? backwards?\b|\bfollow(s|ing)? (the )?(presenter|subject)\b/,
  /\bhandheld\b|\beye level\b|\bnatural shake\b|\bshaky\b/,
  /\bpush[- ]?in\b|\bzoom(s|ing)? in\b|\bpunch[- ]?in\b/,
  /\blocked[- ]?off\b|\bstatic shot\b|\btripod\b/,
  /\borbit\b|\bcircles? (slowly )?around the subject\b/,
  /\blow angle\b|\btilt(s|ing)? up\b/,
  /\bsideways\b|\btracking shot\b|\bslider\b/,
];

/** Every bit of text in the notes (the analysis fields, lists, nested values). */
function notesText(v: unknown, depth = 0): string[] {
  if (depth > 3 || v === null || v === undefined) return [];
  if (typeof v === "string") return [v];
  if (typeof v === "number" || typeof v === "boolean") return [];
  if (Array.isArray(v)) return v.flatMap((x) => notesText(x, depth + 1));
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap((x) => notesText(x, depth + 1));
  return [];
}

/** The Director's own ids (variant keys and REEL_CAMERAS entries) this text names. */
export function directorIdsIn(text: string): string[] {
  const t = text.toLowerCase().replace(/[_]+/g, " ");
  const variants = Object.entries(VARIANT_WORDS).filter(([, re]) => re.test(t)).map(([key]) => key);
  const cameras = REEL_CAMERAS.filter((_, i) => CAMERA_WORDS[i]?.test(t));
  return [...variants, ...cameras];
}

/** What the Director should lean towards and never use, from the owner's matched reel and video examples. */
export function labPreferences(examples: readonly DirectorExample[]): DirectorTaste {
  const prefer = new Set<string>();
  const avoid = new Set<string>();
  for (const e of examples) {
    if (e.rating !== null && e.rating >= 4) for (const id of directorIdsIn([...e.technique, ...e.tags, ...notesText(e.notes)].join(" \n "))) prefer.add(id);
    if (e.neverThis) for (const id of directorIdsIn(e.neverThis)) avoid.add(id);
  }
  return { prefer: [...prefer].filter((id) => !avoid.has(id)), avoid: [...avoid] };
}
