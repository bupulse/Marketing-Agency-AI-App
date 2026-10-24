import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// THE APP CALLS CLAUDE WITH ANTHROPIC_API_KEY ONLY (docs/VIDEO_APP_INTEGRATION.md, section 0). The Video Lab's
// subscription transport (video-lab/claude-cli.ts, the `claude -p` CLI on the owner's Claude subscription) is for the
// owner's own tests; nothing the app deploys may import it or run the CLI.
// One exception, owner decision 23 October 2026 (docs/IMAGE_ENGINE.md): the image engine's Prompter may use the
// subscription on the TEST SITE ONLY, through lib/image-engine/claude-cli.ts, which refuses unless
// IMAGE_ENGINE_CLAUDE_SUBSCRIPTION=1 and the platform is neither Netlify nor Cloudflare (tested below).
// A second, owner decision 24 October 2026 (docs/TRAINING_LAB.md, "The agent team"): the agent team's brain router
// (lib/training-lab/brains.ts) may run a member on the subscription through the same file and the same lock.
const IMAGE_ENGINE_CLI = path.join("lib", "image-engine", "claude-cli.ts");
const IMAGE_ENGINE_PLANNER = path.join("lib", "image-engine", "planner.ts");
const TEAM_BRAINS = path.join("lib", "training-lab", "brains.ts");
const ROOTS = ["app", "lib", "components", "worker.ts", "worker-crons.ts", "middleware.ts", "proxy.ts"];
const CODE = /\.(ts|tsx|js|mjs|cjs)$/;

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  const stat = fs.statSync(p);
  if (stat.isFile()) return CODE.test(p) ? [p] : [];
  return fs.readdirSync(p).flatMap((name) => (name === "node_modules" || name === "generated" ? [] : files(path.join(p, name))));
}

describe("the app never uses the Claude subscription", () => {
  const all = ROOTS.flatMap(files);

  it("scans the app's code", () => {
    expect(all.length).toBeGreaterThan(200);
    expect(all).toContain(path.join("lib", "video-engine", "designer.ts"));
  });

  it("nothing in app/, lib/, components/ or the worker imports video-lab/claude-cli or calls the CLI transport", () => {
    const offenders = all.filter((f) => {
      if (f === IMAGE_ENGINE_CLI || f === IMAGE_ENGINE_PLANNER || f === TEAM_BRAINS) return false;
      const text = fs.readFileSync(f, "utf8");
      return /from\s+["'][^"']*claude-cli["']|import\(\s*["'][^"']*claude-cli["']\s*\)|require\(\s*["'][^"']*claude-cli["']\s*\)|\bsubscriptionTransport\b/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("nothing outside the lab imports from video-lab/ at all", () => {
    const offenders = all.filter((f) => /from\s+["'](@\/|(\.\.\/)+)video-lab\//.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the image engine's and the agent team's exceptions are the only ones and stay test-site only", async () => {
    const importers = all.filter((f) => /from\s+["'][^"']*image-engine\/claude-cli["']|from\s+["']\.\/claude-cli["']/.test(fs.readFileSync(f, "utf8")));
    expect(importers.sort()).toEqual([IMAGE_ENGINE_PLANNER, TEAM_BRAINS].sort());
    const { subscriptionAllowed } = await import("@/lib/image-engine/claude-cli");
    expect(subscriptionAllowed({}, "node")).toBe(false);
    expect(subscriptionAllowed({ IMAGE_ENGINE_CLAUDE_SUBSCRIPTION: "1" }, "netlify")).toBe(false);
    expect(subscriptionAllowed({ IMAGE_ENGINE_CLAUDE_SUBSCRIPTION: "1" }, "cloudflare")).toBe(false);
    expect(subscriptionAllowed({ IMAGE_ENGINE_CLAUDE_SUBSCRIPTION: "1" }, "node")).toBe(true);
  });
});
