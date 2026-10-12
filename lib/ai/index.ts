import "server-only";
import { ClaudeTextProvider } from "./claude-text";
import { DEFAULT_GEMINI_TEXT_FALLBACK, DEFAULT_GEMINI_TEXT_MODEL, GeminiTextProvider } from "./gemini-text";
import type { TextProvider } from "./types";

export * from "./types";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

let textProvider: TextProvider | undefined;

// AI_TEXT_PROVIDER=gemini (default) or claude.
export function getTextProvider(): TextProvider {
  if (textProvider) return textProvider;
  const choice = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();

  switch (choice) {
    case "gemini":
      textProvider = new GeminiTextProvider(
        required("GEMINI_API_KEY"),
        process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL,
        process.env.GEMINI_TEXT_FALLBACK_MODEL ?? DEFAULT_GEMINI_TEXT_FALLBACK,
      );
      break;
    case "claude": {
      const effort = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high";
      textProvider = new ClaudeTextProvider(
        required("ANTHROPIC_API_KEY"),
        process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5",
        effort,
      );
      break;
    }
    default:
      throw new Error(`Unknown AI_TEXT_PROVIDER "${choice}" (use "gemini" or "claude")`);
  }
  return textProvider;
}

let cheapProvider: { provider: TextProvider; model: string } | undefined;

/**
 * The same provider as getTextProvider (AI_TEXT_PROVIDER), on its cheapest model, for short structured calls such as
 * the marketing interview's next question: Gemini Flash-Lite (CHEAP_TEXT_MODEL to change it, the main text model as
 * the busy fallback), or Claude Sonnet at low effort. `model` is what the cost ledger records before the call.
 */
export function getCheapTextProvider(): { provider: TextProvider; model: string } {
  if (cheapProvider) return cheapProvider;
  const choice = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
  if (choice === "claude") {
    const model = process.env.CHEAP_TEXT_MODEL || "claude-sonnet-5-5";
    cheapProvider = { provider: new ClaudeTextProvider(required("ANTHROPIC_API_KEY"), model, "low"), model };
  } else if (choice === "gemini") {
    const model = process.env.CHEAP_TEXT_MODEL || DEFAULT_GEMINI_TEXT_FALLBACK;
    cheapProvider = { provider: new GeminiTextProvider(required("GEMINI_API_KEY"), model, process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL), model };
  } else {
    throw new Error(`Unknown AI_TEXT_PROVIDER "${choice}" (use "gemini" or "claude")`);
  }
  return cheapProvider;
}

// ImageProvider (Gemini image model), VideoProvider (Veo) and VoiceProvider
// (ElevenLabs) get their factories here when those features are built.
