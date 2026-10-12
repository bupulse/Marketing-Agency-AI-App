import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const yml = readFileSync(".github/workflows/publish-posts.yml", "utf8");
const ifOf = (job: string) => new RegExp(`\\n  ${job}:\\n(?:    [^\\n]*\\n)*?    if: ([^\\n]+)`).exec(yml)?.[1] ?? "";

describe("GitHub publish fallback on Netlify", () => {
  it("skips scheduled publish and metrics runs when DEPLOY_TARGET is netlify, but allows a manual run", () => {
    for (const job of ["publish", "metrics"]) {
      const condition = ifOf(job);
      expect(condition, job).toContain("vars.DEPLOY_TARGET != 'netlify'");
      expect(condition, job).toContain("github.event_name == 'workflow_dispatch'");
    }
  });
});
