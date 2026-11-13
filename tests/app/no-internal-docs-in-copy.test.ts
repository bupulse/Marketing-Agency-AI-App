import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Clients cannot open our repository: "Details are in docs/WEBHOOKS.md" on Connectors meant nothing to them (QA 13 Nov).
// Comments may name docs; text a client reads may not. Admin screens are for the owner and stay out of this check.
const ROOT = join(__dirname, "..", "..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "admin") files(path, out);
    } else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

describe("client copy", () => {
  it("never points clients at docs/*.md", () => {
    const hits: string[] = [];
    for (const dir of ["components", "app/dashboard"]) {
      for (const file of files(join(ROOT, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/docs\/[A-Za-z_-]+\.md/.test(line) && !isComment(line)) hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
