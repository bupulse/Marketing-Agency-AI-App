import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { patchClientForWorkers, WASM_OUT } from "@/scripts/cf-build.mjs";
import { ANTHROPIC_MESSAGES_URL, ClaudeTextProvider } from "@/lib/ai/claude-text";
import { createInteraction, GEMINI_API, GeminiHttpError } from "@/lib/ai/gemini-rest";
import { AIProviderError } from "@/lib/ai/types";

vi.mock("server-only", () => ({}));

describe("Workers build (scripts/cf-build.mjs)", () => {
  it("the generated Prisma client takes the query compiler from worker.ts instead of compiling base64", () => {
    const patched = patchClientForWorkers(readFileSync("lib/generated/prisma/internal/class.ts", "utf8"));
    expect(patched).not.toContain("wasm-base64");
    expect(patched).not.toContain("decodeBase64AsWasm");
    expect(patched).toContain("__bupulseWasm?.prismaQueryCompiler");
    expect(() => patchClientForWorkers("export {}")).toThrow(/generated Prisma client changed/);
  });

  it("worker.ts imports the module the build writes", () => {
    expect(readFileSync("worker.ts", "utf8")).toContain(`from "./${WASM_OUT}"`);
  });
});

describe("AI providers over plain fetch (no SDKs in the Worker)", () => {
  it("Claude: one Messages API call, text joined, errors mapped", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "Hi" }, { type: "text", text: "!" }], usage: { input_tokens: 3, output_tokens: 2 } }));
    const claude = new ClaudeTextProvider("key", "m", "low", fetchImpl as unknown as typeof fetch);
    expect(await claude.generate({ system: "s", prompt: "p" })).toEqual({ text: "Hi!", provider: "claude", model: "m", usage: { inputTokens: 3, outputTokens: 2 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(init.headers).toMatchObject({ "x-api-key": "key", "anthropic-version": "2023-06-01" });
    const status = (s: number) => new ClaudeTextProvider("key", "m", "low", (async () => new Response("", { status: s })) as unknown as typeof fetch).generate({ system: "s", prompt: "p" });
    await expect(status(429)).rejects.toMatchObject({ retryable: true });
    await expect(status(400)).rejects.toMatchObject({ retryable: false });
    await expect(status(503)).rejects.toBeInstanceOf(AIProviderError);
  });

  it("Gemini: POST /interactions with the key header; only the status of an error is kept", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "i1", steps: [] }));
    expect(await createInteraction("key", { model: "g" }, 1000, fetchImpl as unknown as typeof fetch)).toEqual({ id: "i1", steps: [] });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(`${GEMINI_API}/interactions`);
    await expect(createInteraction("key", {}, 1000, (async () => new Response("prompt echo", { status: 500 })) as unknown as typeof fetch)).rejects.toEqual(new GeminiHttpError(500));
    await expect(createInteraction("key", {}, 1000, (async () => Promise.reject(new Error("net"))) as unknown as typeof fetch)).rejects.toMatchObject({ status: undefined });
  });
});
