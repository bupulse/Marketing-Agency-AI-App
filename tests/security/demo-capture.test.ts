import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 9 (H1): the demo capture scripts take the demo accounts' password from DEMO_CAPTURE_PASSWORD; none is committed.

const DIR = join(__dirname, "..", "..", "Demo", "capture");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo capture password", () => {
  it("comes from DEMO_CAPTURE_PASSWORD and is required", async () => {
    const { demoPassword } = await import("../../Demo/capture/accounts.mjs");
    vi.stubEnv("DEMO_CAPTURE_PASSWORD", "");
    expect(() => demoPassword()).toThrow(/DEMO_CAPTURE_PASSWORD/);
    vi.stubEnv("DEMO_CAPTURE_PASSWORD", "from-the-environment");
    expect(demoPassword()).toBe("from-the-environment");
  });

  it("no capture script hard-codes a password", () => {
    for (const name of readdirSync(DIR).filter((f) => f.endsWith(".mjs"))) {
      const text = readFileSync(join(DIR, name), "utf8");
      expect(text, name).not.toMatch(/(?:const|let|var)\s+\w*PASSWORD\w*\s*=\s*["'`]/i);
      expect(text, name).not.toMatch(/password:\s*["'`][^"'`]{6,}/i);
      expect(text, name).not.toMatch(/fill\([^)]*password[^)]*,\s*["'`]/i);
    }
  });
});
