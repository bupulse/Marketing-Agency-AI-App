// The reel engine's clip Checker (docs/REEL_ENGINE.md): Gemini watches every filmed clip, like the image engine's
// Checker looks at every picture, for what the owner saw in the first test reels: "it has AI slop… it doesn't obey
// physics at all, you don't see hands touching the leaf and you can see people passing through products". A clip that
// fails is filmed again with what went wrong (engine.ts, at most MAX_REFILMS a reel). About $0.003 a clip; when the
// check cannot run, the clip passes (a check never blocks a reel).
import "server-only";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";

export type ClipVerdict = { ok: boolean; problems: string[]; ran: boolean };

export const CLIP_CHECK_PROMPT = [
  "You check AI-generated video clips for a social-media reel before they are used. Watch the whole clip closely.",
  "FAIL the clip for any of these, even for a moment:",
  "- a body, a hand or an object passes through another object or person, or a person walks through a product;",
  "- a hand looks like it touches something without contact, melts into it, or has clearly extra, missing or fused fingers;",
  "- a face melts, changes into another person, or the presenter's identity changes;",
  "- the product changes shape, size or number, appears from nothing or vanishes;",
  "- garbled text, letters or a logo appear anywhere;",
  "- a camera, a phone on a stand, a tripod, a microphone or film lights are visible;",
  "- a hard cut or a jump inside the clip;",
  "- the place does not fit the product (the SETTING below), or a crowd fills the background.",
  "Small softness, grain or a little motion blur is fine: only fail what a viewer would notice as fake.",
  'Answer as JSON {"ok": true|false, "problems": ["short, concrete description with the second it happens", …]} with at most 4 problems.',
].join("\n");

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" }, problems: { type: "array", items: { type: "string" } } }, required: ["ok", "problems"] };

/** The verdict from the model's answer: only an explicit failure with a reason fails a clip. */
export function readClipVerdict(raw: unknown): ClipVerdict {
  const r = (raw && typeof raw === "object" ? raw : {}) as { ok?: unknown; problems?: unknown };
  const problems = (Array.isArray(r.problems) ? r.problems : []).filter((p): p is string => typeof p === "string" && p.trim().length > 3).map((p) => p.trim().slice(0, 200)).slice(0, 4);
  return { ok: !(r.ok === false && problems.length), problems, ran: true };
}

/** The check prompt with the owner's visual "never this" notes (Training Lab) as extra FAIL lines: at most 6, 160 letters each. */
export function clipCheckPrompt(avoid: readonly string[] = []): string {
  const extra = avoid.map((a) => a.replace(/\s+/g, " ").trim().slice(0, 160)).filter(Boolean).slice(0, 6);
  return extra.length ? `${CLIP_CHECK_PROMPT}\nAlso FAIL the clip for these, the owner's notes:\n${extra.map((a) => `- ${a}`).join("\n")}` : CLIP_CHECK_PROMPT;
}

export async function checkClip(owner: { userId: string; businessId: string }, mp4: Uint8Array, setting: string | null, opts: { fetchImpl?: typeof fetch; avoid?: readonly string[] } = {}): Promise<ClipVerdict> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: true, problems: [], ran: false };
  const model = process.env.REEL_CHECK_MODEL || process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_TEXT_MODEL;
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: "video/mp4", data: Buffer.from(mp4).toString("base64") } }, { text: `${clipCheckPrompt(opts.avoid)}\nSETTING: ${setting || "where the product is really used"}.` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 600 },
  };
  try {
    const result = await withLedger(
      { ...owner, feature: "reelEngine" },
      { provider: "gemini", model },
      async () => {
        const res = await (opts.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`The clip check answered ${res.status}.`);
        const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
        return { text: j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", usage: { inputTokens: j.usageMetadata?.promptTokenCount ?? 0, outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0 } };
      },
      (r) => ({ provider: "gemini", model, usage: r.usage }),
    );
    return readClipVerdict(JSON.parse(result.text));
  } catch {
    return { ok: true, problems: [], ran: false };
  }
}
