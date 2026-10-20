import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// THE APP CALLS CLAUDE WITH ANTHROPIC_API_KEY ONLY (docs/VIDEO_APP_INTEGRATION.md, section 0). The Video Lab's
// subscription transport (video-lab/claude-cli.ts, the `claude -p` CLI on the owner's Claude subscription) is for the
// owner's own tests; nothing the app deploys may import it or run the CLI.
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
      const text = fs.readFileSync(f, "utf8");
      return /from\s+["'][^"']*claude-cli["']|import\(\s*["'][^"']*claude-cli["']\s*\)|require\(\s*["'][^"']*claude-cli["']\s*\)|\bsubscriptionTransport\b/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("nothing outside the lab imports from video-lab/ at all", () => {
    const offenders = all.filter((f) => /from\s+["'](@\/|(\.\.\/)+)video-lab\//.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
