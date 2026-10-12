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
    // The token is never job-wide.
    expect(yml.split("\n").filter((l) => l.includes("NETLIFY_AUTH_TOKEN:")).every((l) => l.startsWith("          "))).toBe(true);
  });
});
