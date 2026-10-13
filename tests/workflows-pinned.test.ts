import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Supply chain (v2 pre-launch review): third-party actions are pinned to full commit SHAs, checkouts keep no token,
// and the Netlify token only reaches the upload step, never the build.

const dir = ".github/workflows";
const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));

describe("GitHub workflows", () => {
  it.each(files)("%s pins every action to a full commit SHA with its version in a comment", (file) => {
    const yml = readFileSync(`${dir}/${file}`, "utf8");
    for (const [, ref] of yml.matchAll(/uses:\s*([^\s#]+)([^\n]*)/g)) {
      expect(ref, `${file}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
    for (const [, comment] of yml.matchAll(/uses:\s*[^\s#]+\s*(#[^\n]*)?/g)) expect(comment ?? "", file).toMatch(/^# v\d+\.\d+\.\d+$/);
  });

  it.each(files)("%s checks out without persisting credentials", (file) => {
    const yml = readFileSync(`${dir}/${file}`, "utf8");
    const checkouts = [...yml.matchAll(/- uses: actions\/checkout@[^\n]+\n((?: {8,}[^\n]*\n)*)/g)];
    for (const [, block] of checkouts) expect(block).toContain("persist-credentials: false");
  });

  it("video robot: every 15 minutes, read-only, never overlapping, no artifacts, secret only where it is used", () => {
    const yml = readFileSync(`${dir}/video-robot.yml`, "utf8");
    expect(yml).toContain('cron: "*/15 * * * *"');
    expect(yml).toContain("workflow_dispatch:");
    expect(yml).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    expect(yml).toMatch(/\nconcurrency:\n {2}group: video-robot\n {2}cancel-in-progress: false\n/);
    expect(yml).toContain("timeout-minutes: 20");
    expect(yml).toContain("persist-credentials: false");
    expect(yml).not.toMatch(/upload-artifact|actions\/cache@|set -x|curl /);
    expect(yml).toContain("ROBOT_APP_URL: ${{ vars.ROBOT_APP_URL }}");
    // The secret is never job-wide: only the steps that call the app get it.
    const secretLines = yml.split("\n").filter((l) => l.includes("secrets.VIDEO_ROBOT_SECRET"));
    expect(secretLines.length).toBe(3);
    expect(secretLines.every((l) => l.startsWith("          VIDEO_ROBOT_SECRET: "))).toBe(true);
    // Skips quietly when not set up.
    expect(yml).toContain("steps.setup.outputs.ready == 'true'");
  });

  it("Netlify: builds without the token, then deploys the build without building", () => {
    const yml = readFileSync(`${dir}/deploy-netlify.yml`, "utf8");
    const steps = yml.split(/\n      - /);
    const build = steps.find((s) => s.includes('"$NETLIFY_CLI" build'))!;
    const deploy = steps.find((s) => s.includes('"$NETLIFY_CLI" deploy'))!;
    expect(build).toContain("--offline");
    expect(build).not.toContain("NETLIFY_AUTH_TOKEN");
    expect(deploy).toContain("--no-build");
    expect(deploy).toContain("--prod");
    expect(deploy).not.toContain("--build ");
    expect(deploy).toContain("NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}");
    // The variables are checked (by this repository's script only) before any package is installed.
    expect(yml.indexOf("node scripts/check-env.mjs --build")).toBeGreaterThan(0);
    expect(yml.indexOf("node scripts/check-env.mjs --netlify")).toBeLessThan(yml.indexOf("- run: npm ci"));
    expect(yml.indexOf("node scripts/check-env.mjs --build")).toBeLessThan(yml.indexOf("- run: npm ci"));
    // Every NEXT_PUBLIC_* value the code reads is a build value of the deploy.
    expect(yml).toContain("NEXT_PUBLIC_WHATSAPP_NUMBER: ${{ vars.NEXT_PUBLIC_WHATSAPP_NUMBER }}");
    // The token is never job-wide.
    expect(yml.split("\n").filter((l) => l.includes("NETLIFY_AUTH_TOKEN:")).every((l) => l.startsWith("          "))).toBe(true);
  });
});
