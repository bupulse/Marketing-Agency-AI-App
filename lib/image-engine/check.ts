// The Checker's eyes (checker.ts judges): Gemini Flash reads the words in a finished picture and says whether the
// product is visible. Through the cost ledger (feature "imageEngine"). Never throws: a check that cannot run counts
// as passed, so a picture is never lost to the Checker.
import "server-only";
import { createInteraction } from "@/lib/ai/gemini-rest";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { logError } from "@/lib/errors";
import { judge, type Expected, type Verdict } from "./checker";

const SCHEMA = {
  type: "object",
  properties: {
    texts: { type: "array", items: { type: "string" } },
    lines: {
      type: "array",
      items: { type: "object", properties: { expected: { type: "string" }, written: { type: "string" }, same_letters: { type: "boolean" } }, required: ["expected", "written", "same_letters"] },
    },
    product_visible: { type: "boolean" },
  },
  required: ["texts", "lines", "product_visible"],
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function checkPicture(owner: { userId: string; businessId: string }, image: { bytes: Uint8Array; mimeType: string }, expected: Expected & { product: string }): Promise<Verdict & { ran: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: true, problems: [], fix: null, ran: false };
  const model = process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL;
  try {
    const interaction = await withLedger(
      { ...owner, feature: "imageEngine" },
      { provider: "gemini", model },
      () =>
        createInteraction(
          apiKey,
          {
            model,
            store: false,
            system_instruction:
              "You are a strict proofreader of advertising images. You copy text letter by letter exactly as it is drawn, including spelling mistakes, missing or extra letters and wrong words. You never correct, guess or complete a word.",
            input: [
              { type: "image", data: toBase64(image.bytes), mime_type: image.mimeType },
              {
                type: "text",
                text: [
                  "1. texts: every piece of text in the picture, copied letter by letter as drawn.",
                  "2. lines: for each line below, find it in the picture and copy what is really drawn there letter by letter (\"written\"), then say whether every letter is the same as the line (\"same_letters\"). Check each word letter by letter; one wrong, missing or extra letter means false. If the line is not in the picture, written is \"\" and same_letters is false.",
                  ...[expected.headline, expected.subline, expected.cta].filter(Boolean).map((l) => `LINE: ${l}`),
                  `3. product_visible: is this product clearly visible: ${expected.product.slice(0, 200)}?`,
                ].join("\n"),
              },
            ],
            generation_config: { max_output_tokens: 800, thinking_level: "low" },
            response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
          },
          45_000,
        ),
      (r) => ({ provider: "gemini", model, usage: { inputTokens: r.usage?.total_input_tokens ?? 0, outputTokens: (r.usage?.total_output_tokens ?? 0) + (r.usage?.total_thought_tokens ?? 0) } }),
    );
    const text = (interaction.steps ?? []).flatMap((s) => (s.type === "model_output" ? (s.content ?? []) : [])).find((c) => c.type === "text")?.text ?? "";
    const seen = JSON.parse(text) as { texts?: unknown; lines?: unknown; product_visible?: unknown };
    const texts = Array.isArray(seen.texts) ? seen.texts.filter((t): t is string => typeof t === "string").slice(0, 40) : [];
    const lines = (Array.isArray(seen.lines) ? seen.lines : [])
      .filter((l): l is { expected: string; written: string; same_letters: boolean } => !!l && typeof l.expected === "string" && typeof l.written === "string")
      .slice(0, 5)
      .map((l) => ({ expected: l.expected, written: l.written, same: l.same_letters === true }));
    return { ...judge(expected, { texts, lines, productVisible: seen.product_visible !== false }), ran: true };
  } catch (error) {
    await logError(error, { source: "image-engine.check", level: "warn", businessId: owner.businessId });
    return { ok: true, problems: [], fix: null, ran: false };
  }
}
