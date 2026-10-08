import "server-only";
import { withLedger } from "@/lib/ai/ledger";
import { DEFAULT_GEMINI_TEXT_MODEL, GeminiTextProvider } from "@/lib/ai/gemini-text";
import { AIProviderError } from "@/lib/ai/types";
import { buildConversationPrompt, buildSystemPrompt, chatReplyJsonSchema, parseChatReply, type BusinessFacts, type ChatReply, type ChatTurn } from "./prompt";

export const DEFAULT_WIDGET_MODEL = "gemini-3.1-flash-lite";

let provider: GeminiTextProvider | undefined;
let providerKey = "";

// Flash-Lite answers; if it is busy the main text model takes over.
function getWidgetProvider() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  const model = process.env.WIDGET_MODEL || DEFAULT_WIDGET_MODEL;
  const fallback = process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_TEXT_MODEL;
  const id = `${apiKey}|${model}|${fallback}`;
  if (!provider || providerKey !== id) {
    provider = new GeminiTextProvider(apiKey, model, fallback);
    providerKey = id;
  }
  return { provider, model };
}

/** One AI reply, recorded in the cost ledger as feature "widget". Throws when it fails. */
export async function generateChatReply(input: {
  facts: BusinessFacts;
  history: ChatTurn[];
  leadCaptured: boolean;
  userId: string;
  businessId: string;
}): Promise<ChatReply> {
  const { provider, model } = getWidgetProvider();
  const result = await withLedger(
    { userId: input.userId, businessId: input.businessId, feature: "widget" },
    { provider: provider.name, model },
    () =>
      provider.generate({
        system: buildSystemPrompt(input.facts, { leadCaptured: input.leadCaptured }),
        prompt: buildConversationPrompt(input.history),
        jsonSchema: chatReplyJsonSchema,
      }),
    (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
  );
  const reply = parseChatReply(result.text);
  if (!reply) throw new AIProviderError("Widget reply was not usable", provider.name, false, result.usage, result.model);
  return reply;
}
