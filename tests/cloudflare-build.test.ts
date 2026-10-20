import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { BRAIN_PACKAGE, BRAIN_SOURCE, DATA_PACKAGE, externalizeClientData, patchClientForWorkers, restoreOnExit, WASM_OUT } from "@/scripts/cf-build.mjs";
import brainDataLoader from "@/scripts/cf-brain-data-loader.cjs";
import { ANTHROPIC_MESSAGES_URL, ClaudeTextProvider } from "@/lib/ai/claude-text";
import { createInteraction, GEMINI_API, GeminiHttpError } from "@/lib/ai/gemini-rest";
import { AIProviderError } from "@/lib/ai/types";
import { backoffMs, fetchWithRetry, retryAfterMs } from "@/lib/ai/http-retry";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/errors", () => ({ logError }));

describe("Workers build (scripts/cf-build.mjs)", () => {
  it("the generated Prisma client takes the query compiler from worker.ts instead of compiling base64", () => {
    const patched = patchClientForWorkers(readFileSync("lib/generated/prisma/internal/class.ts", "utf8"));
    expect(patched).not.toContain("wasm-base64");
    expect(patched).not.toContain("decodeBase64AsWasm");
    expect(patched).toContain("__bupulseWasm?.prismaQueryCompiler");
    expect(() => patchClientForWorkers("export {}")).toThrow(/generated Prisma client changed/);
  });

  it("the client's data moves to one package with the same values (bundled once in the Worker, next.config.ts lists it)", () => {
    const source = patchClientForWorkers(readFileSync("lib/generated/prisma/internal/class.ts", "utf8"));
    const { source: patched, data } = externalizeClientData(source);
    expect(patched.length).toBeLessThan(source.length / 10);
    expect(patched).toContain(`import * as __dataModule from "${DATA_PACKAGE}"`);
    for (const ref of ['"inlineSchema": __data.inlineSchema,', "config.runtimeDataModel = __data.runtimeDataModel", "strings: __data.strings,", "graph: __data.graph"]) expect(patched).toContain(ref);
    // The data module evaluates to exactly what the generated client held.
    const mod = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", data)(mod, mod.exports);
    const inline = /^ {2}"inlineSchema": (".*"),$/m.exec(source)![1];
    expect(mod.exports.inlineSchema).toBe(JSON.parse(inline));
    expect(mod.exports.runtimeDataModel).toEqual(JSON.parse(JSON.parse(/^config\.runtimeDataModel = JSON\.parse\((".*")\)$/m.exec(source)![1])));
    expect((mod.exports.strings as string[]).length).toBeGreaterThan(100);
    expect(mod.exports.graph).toBe(JSON.parse(/^ {2}graph: (".*")$/m.exec(source)![1]));
    expect(readFileSync("next.config.ts", "utf8")).toContain(`"${DATA_PACKAGE}"`);
    expect(() => externalizeClientData("export {}")).toThrow(/generated Prisma client changed/);
  });

  it("Ctrl+C or a kill restores the usual client once, then exits", () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const restore = vi.fn();
    const once = restoreOnExit(restore, proc as unknown as NodeJS.Process);
    proc.emit("SIGINT");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(130);
    once();
    proc.emit("SIGTERM");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenLastCalledWith(143);
  });

  it("worker.ts imports the module the build writes", () => {
    expect(readFileSync("worker.ts", "utf8")).toContain(`from "./${WASM_OUT}"`);
  });

  it("server code requires the video brain's data files from one package (same file names, next.config.ts lists it)", () => {
    const out = brainDataLoader.call({ resourcePath: `/repo/${BRAIN_SOURCE}/viral.json` });
    expect(out).toBe(`module.exports = require("${BRAIN_PACKAGE}/viral.json");\n`);
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain(`"${BRAIN_PACKAGE}"`);
    expect(config).toContain("scripts/cf-brain-data-loader.cjs");
    expect(config).toContain(String.raw`/^lib\/video-engine\/brain\/data\/[^/]+\.json$/`);
    expect(BRAIN_SOURCE).toBe("lib/video-engine/brain/data");
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
  });

  it("Claude: errors mapped; a 4xx logs only the error type; an unreadable answer is retryable", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const answer = (res: () => Response) => {
        const call = new ClaudeTextProvider("key", "m", "low", (async () => res()) as unknown as typeof fetch).generate({ system: "s", prompt: "SECRET PROMPT" });
        call.catch(() => undefined);
        return vi.runAllTimersAsync().then(() => call);
      };
      await expect(answer(() => new Response("", { status: 429 }))).rejects.toMatchObject({ retryable: true });
      await expect(answer(() => new Response("", { status: 503 }))).rejects.toBeInstanceOf(AIProviderError);
      logError.mockClear();
      const billing = () => Response.json({ type: "error", error: { type: "billing_error", message: "SECRET PROMPT was too long" } }, { status: 400 });
      await expect(answer(billing)).rejects.toMatchObject({ retryable: false });
      expect(logError).toHaveBeenCalledTimes(1);
      expect(String(logError.mock.calls[0][0].message)).toBe("claude answered 400 (billing_error)");
      expect(JSON.stringify(logError.mock.calls[0])).not.toContain("SECRET");
      await expect(answer(() => new Response("{not json", { status: 200 }))).rejects.toMatchObject({ retryable: true, message: "Claude answer could not be read" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("Gemini: POST /interactions with the key header; only the status of an error is kept", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "i1", steps: [] }));
    expect(await createInteraction("key", { model: "g" }, 1000, fetchImpl as unknown as typeof fetch)).toEqual({ id: "i1", steps: [] });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(`${GEMINI_API}/interactions`);
    await expect(createInteraction("key", {}, 1000, (async () => new Response("prompt echo", { status: 500 })) as unknown as typeof fetch)).rejects.toEqual(new GeminiHttpError(500));
    logError.mockClear();
    const denied = async () => Response.json({ error: { code: 403, status: "PERMISSION_DENIED", message: "prompt echo" } }, { status: 403 });
    await expect(createInteraction("key", { model: "g" }, 1000, denied as unknown as typeof fetch)).rejects.toEqual(new GeminiHttpError(403));
    expect(String(logError.mock.calls[0][0].message)).toBe("gemini answered 403 (PERMISSION_DENIED)");
    await expect(createInteraction("key", {}, 1000, (async () => Promise.reject(new Error("net"))) as unknown as typeof fetch)).rejects.toMatchObject({ status: undefined });
  });
});

describe("AI retries (lib/ai/http-retry.ts)", () => {
  const noSleep = vi.fn(async () => undefined);
  const seq = (...statuses: (number | Error)[]) => {
    const f = vi.fn(async () => {
      const next = statuses.shift()!;
      if (next instanceof Error) throw next;
      return new Response("", { status: next, headers: next === 429 ? { "retry-after": "3" } : {} });
    });
    return f as unknown as typeof fetch & { mock: { calls: unknown[] } };
  };

  it("retries 408, 409, 429, 5xx and network errors twice at most, then returns the last answer", async () => {
    const f = seq(503, 429, 200);
    expect((await fetchWithRetry("u", {}, { budgetMs: 60_000, fetchImpl: f, sleep: noSleep, random: () => 0 })).status).toBe(200);
    expect(f.mock.calls).toHaveLength(3);
    expect(noSleep.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([500, 3000]);
    const g = seq(500, 500, 500, 200);
    expect((await fetchWithRetry("u", {}, { budgetMs: 60_000, fetchImpl: g, sleep: noSleep })).status).toBe(500);
    expect(g.mock.calls).toHaveLength(3);
    const net = seq(new TypeError("fetch failed"), 408, 409);
    expect((await fetchWithRetry("u", {}, { budgetMs: 60_000, fetchImpl: net, sleep: noSleep })).status).toBe(409);
    await expect(fetchWithRetry("u", {}, { budgetMs: 60_000, fetchImpl: seq(new TypeError("a"), new TypeError("b"), new TypeError("c")), sleep: noSleep })).rejects.toThrow("c");
  });

  it("does not retry other 4xx, a timeout, or when the budget has no room left", async () => {
    const f = seq(400, 200);
    expect((await fetchWithRetry("u", {}, { budgetMs: 60_000, fetchImpl: f, sleep: noSleep })).status).toBe(400);
    expect(f.mock.calls).toHaveLength(1);
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    await expect(fetchWithRetry("u", {}, { budgetMs: 60_000, fetchImpl: seq(timeout, 200), sleep: noSleep })).rejects.toBe(timeout);
    let t = 0;
    const late = seq(503, 200);
    expect((await fetchWithRetry("u", {}, { budgetMs: 4_000, fetchImpl: late, sleep: noSleep, now: () => t++ })).status).toBe(503);
  });

  it("backoff: exponential with jitter, retry-after honoured but capped at 8 s", () => {
    expect([backoffMs(1, null, () => 0), backoffMs(2, null, () => 0), backoffMs(2, null, () => 1)]).toEqual([500, 1000, 1500]);
    expect(backoffMs(1, 3000, () => 0)).toBe(3000);
    expect(backoffMs(1, 600_000, () => 0)).toBe(8000);
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs("soon")).toBeNull();
  });
});
