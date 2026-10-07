import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions = { create };
  },
}));

import { GeminiTextProvider } from "@/lib/ai/gemini-text";
import { AIProviderError } from "@/lib/ai/types";

const reply = (text: string) => ({
  id: "i1",
  status: "completed",
  steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text }] }],
  usage: { total_input_tokens: 10, total_output_tokens: 5, total_thought_tokens: 20 },
});
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("GeminiTextProvider", () => {
  beforeEach(() => create.mockReset());

  it("returns the model output text and counts thinking as output", async () => {
    create.mockResolvedValue(reply('{"a":1}'));
    const result = await new GeminiTextProvider("k", "main", "lite").generate({ system: "s", prompt: "p", jsonSchema: { type: "object" } });
    expect(result).toEqual({ text: '{"a":1}', provider: "gemini", model: "main", usage: { inputTokens: 10, outputTokens: 25 } });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "main",
      system_instruction: "s",
      input: "p",
      response_format: { type: "text", mime_type: "application/json", schema: { type: "object" } },
    });
  });

  it("falls back to the second model when the main one is busy", async () => {
    create.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce(reply("ok"));
    const result = await new GeminiTextProvider("k", "main", "lite").generate({ system: "s", prompt: "p" });
    expect(result.model).toBe("lite");
    expect(create.mock.calls[1][0].model).toBe("lite");
  });

  it("does not fall back on a request error", async () => {
    create.mockRejectedValueOnce(httpError(400));
    const error = await new GeminiTextProvider("k", "main", "lite").generate({ system: "s", prompt: "p" }).catch((e) => e);
    expect(error).toBeInstanceOf(AIProviderError);
    expect([error.retryable, error.model]).toEqual([false, "main"]);
    expect(create.mock.calls).toHaveLength(1);
  });

  it("reports billed usage when no text comes back", async () => {
    create.mockResolvedValue({ ...reply(""), steps: [] });
    const error = await new GeminiTextProvider("k", "main").generate({ system: "s", prompt: "p" }).catch((e) => e);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error.usage).toEqual({ inputTokens: 10, outputTokens: 25 });
  });
});
