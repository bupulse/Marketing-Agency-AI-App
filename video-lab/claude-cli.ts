// Video Lab only (docs/VIDEO_ENGINE.md): designs through the owner's Claude SUBSCRIPTION, by running the Claude Code CLI
// (`claude -p`) logged in on this computer, instead of the API key. Owner decision for testing (16 October 2026).
// NEVER use this in the app or in production: a subscription is for the owner's own use. Before deploying, switch to
// ANTHROPIC_API_KEY (the engine's default transport in lib/video-engine/designer.ts).
//
// The CLI runs in restricted mode (no command or code tools, no settings, hooks or MCP servers), with only the Read tool,
// inside a temporary folder that holds this video's photos, so Claude can look at them and nothing else.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { DesignError, type ClaudeTransport } from "@/lib/video-engine/designer";

const TMP = path.resolve("video-lab/data/tmp");
const TIMEOUT_MS = 6 * 60_000;

type CliResult = {
  type?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
};

/** The environment for the CLI: no API key (so it uses the subscription login) and no nested-session markers. */
function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN" || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
    env[k] = v;
  }
  return env;
}

function run(args: string[], input: string, cwd: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.VIDEO_LAB_CLAUDE_BIN || "claude", args, { cwd, env: cliEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", () => undefined);
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
    child.stdin.end(input);
  });
}

/** Model id for the CLI: "claude-sonnet-5-5" works as is; the alias "sonnet" also does. */
export const subscriptionTransport = (): ClaudeTransport => async ({ model, system, content }) => {
  const dir = await fs.mkdtemp(path.join(await fs.mkdir(TMP, { recursive: true }).then(() => TMP), "design-"));
  try {
    // Images become files the CLI's Read tool opens; text blocks stay text, in order.
    let n = 0;
    const parts: string[] = [];
    for (const block of content as { type: string; text?: string; source?: { data: string } }[]) {
      if (block.type === "text" && block.text) parts.push(block.text);
      if (block.type === "image" && block.source?.data) {
        n += 1;
        const name = `photo-${n}.jpg`;
        await fs.writeFile(path.join(dir, name), Buffer.from(block.source.data, "base64"));
        parts.push(`(This photo is the file ./${name}: open it with the Read tool and look at it before designing.)`);
      }
    }
    parts.push("Look at every photo file first, then answer with the JSON object only (no tool use after that, no other text).");
    const args = ["-p", "--model", model, "--output-format", "json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--tools", "Read", "--allowedTools", "Read", "--system-prompt", system];
    const { code, stdout } = await run(args, parts.join("\n\n"), dir).catch(() => {
      throw new DesignError("The Claude app (claude) could not be started. Is Claude Code installed and logged in on this computer?");
    });
    let out: CliResult;
    try {
      out = JSON.parse(stdout) as CliResult;
    } catch {
      throw new DesignError(code === null ? "Claude took too long (over 6 minutes)." : "The Claude app gave no readable answer. Run `claude` once in a terminal to check you are logged in.");
    }
    const u = out.usage ?? {};
    const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const outputTokens = u.output_tokens ?? 0;
    const usedModel = Object.keys(out.modelUsage ?? {})[0] ?? model;
    const usage = { model: usedModel, inputTokens, outputTokens, costUsd: 0, billedTo: "subscription" as const, apiEquivalentUsd: estimateCostUsd(usedModel, { inputTokens, outputTokens }) };
    if (out.is_error) {
      const msg = (out.result ?? "").toLowerCase();
      throw new DesignError(msg.includes("limit") ? "Your Claude subscription's usage limit is reached for now. Try again later." : msg.includes("log") ? "The Claude app is not logged in. Run `claude` in a terminal and log in." : "Claude could not design the video. Please try again.", [usage]);
    }
    return { text: out.result ?? "", usage, stop: out.stop_reason ?? "end_turn" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};
