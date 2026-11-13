import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "Add to your plan" (/dashboard/upgrade) explains one feature, named by ?feature=. QA 13 Nov: Autopilot's "See the
// plans" linked to the bare page, which answered "This page could not be found".
const ROOT = join(__dirname, "..", "..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

describe("links to Add to your plan", () => {
  it("always name the feature", () => {
    const bare: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of files(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        if (/["'`]\/dashboard\/upgrade["'`]/.test(text)) bare.push(file.slice(ROOT.length + 1));
      }
    }
    expect(bare).toEqual([]);
  });
});
