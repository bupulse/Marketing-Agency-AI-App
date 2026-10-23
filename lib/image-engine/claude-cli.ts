// Claude for the image engine's Prompter through the owner's Claude SUBSCRIPTION (the Claude Code CLI, `claude -p`)
// while BuPulse has no Anthropic API key. Owner decision, 23 October 2026: TEST SITE ONLY. A subscription is for the
// owner's own use, so this runs only when IMAGE_ENGINE_CLAUDE_SUBSCRIPTION=1 is set on the Mac that serves
// test.bupulse.com, and never on Netlify or Cloudflare (bupulse.com). With ANTHROPIC_API_KEY set, planner.ts uses the
// API instead. The CLI runs with no tools at all, in a fresh temporary folder, and answers one JSON object.
import "server-only";
import { currentPlatform } from "@/lib/platform/detect";

const TIMEOUT_MS = 150_000;
export const SUBSCRIPTION_MODEL = "claude-sonnet-5-5";

/** True only on the owner's own server with the switch on. */
export function subscriptionAllowed(env: Record<string, string | undefined> = process.env, platform: string = currentPlatform()): boolean {
  return env.IMAGE_ENGINE_CLAUDE_SUBSCRIPTION === "1" && platform !== "netlify" && platform !== "cloudflare";
}

/** The CLI's environment: no API key (so it uses the subscription login) and no nested-session markers. */
function cliEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN" || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
    env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

/** One answer from Claude on the subscription: { text, inputTokens, outputTokens }. Throws on any problem. */
export async function claudeBySubscription(system: string, prompt: string, jsonSchema: object): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
  if (!subscriptionAllowed()) throw new Error("Claude by subscription is not allowed here");
  const [{ spawn }, fs, os, path] = await Promise.all([import("node:child_process"), import("node:fs/promises"), import("node:os"), import("node:path")]);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-prompter-"));
  try {
    const args = ["-p", "--model", SUBSCRIPTION_MODEL, "--output-format", "json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--tools", "", "--system-prompt", system, "--json-schema", JSON.stringify(jsonSchema)];
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.env.IMAGE_ENGINE_CLAUDE_BIN || "claude", args, { cwd: dir, env: cliEnv(), stdio: ["pipe", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(out);
      });
      child.stdin.end(prompt);
    });
    const out = JSON.parse(stdout) as { is_error?: boolean; result?: string; structured_output?: unknown; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
    if (out.is_error) throw new Error("Claude (subscription) answered with an error");
    const u = out.usage ?? {};
    const text = out.structured_output !== undefined ? JSON.stringify(out.structured_output) : (out.result ?? "");
    return { text, inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, model: SUBSCRIPTION_MODEL };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
