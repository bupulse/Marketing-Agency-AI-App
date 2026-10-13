import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createLogger, formatLine } from "../scripts/video-robot/log.mjs";
import { api, settings } from "../scripts/video-robot/robot.mjs";

// The repository is public, so the video robot's GitHub Actions log is public (docs/VIDEO_ROBOT.md): it prints fixed
// event names with counts and a few known words, nothing else.

const SECRET_BITS = ["Kigali Kicks", "https://bupulse.example", "s3cret-token", "11111111-1111-4111-8111-111111111111", "user/videos/v1-abc.mp4", "eyJhbGciOiJIUzI1NiJ9.x.y"];

describe("video robot logger", () => {
  it("prints known events with counts and known words only", () => {
    const lines: string[] = [];
    const log = createLogger((l: string) => lines.push(l));
    log("summary", { claimed: 2, made: 1, failed: 1 });
    log("failed", { reason: "timeout" });
    expect(lines).toEqual(["[video-robot] Run finished: claimed 2, made 1, failed 1", "[video-robot] Failed: reason timeout"]);
  });

  it("drops unknown events, free text, URLs, ids, tokens, negative and huge numbers", () => {
    const lines: string[] = [];
    const log = createLogger((l: string) => lines.push(l));
    for (const bit of SECRET_BITS) {
      log(bit);
      log("failed", { reason: bit, business: bit, [bit]: 1 });
      log("claimed", { videos: bit });
    }
    log("claimed", { videos: -1, other: 1.5, big: 1e9 });
    const out = lines.join("\n");
    for (const bit of SECRET_BITS) expect(out).not.toContain(bit);
    expect(out).not.toMatch(/https?:|\d{5,}|-1|1\.5/);
    expect(formatLine("nope")).toBeNull();
  });

  it("the robot script prints only through the logger", () => {
    for (const file of ["robot.mjs", "build-page.mjs", "page-entry.ts"]) {
      const source = readFileSync(`scripts/video-robot/${file}`, "utf8");
      expect(source, file).not.toMatch(/console\.(log|error|warn|info|debug)|process\.std(out|err)\.write/);
    }
  });

  it("an API error prints the call and status, never the URL, the secret or the answer", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(l));
    try {
      const config = settings({ ROBOT_APP_URL: "https://bupulse.example/", VIDEO_ROBOT_SECRET: "s3cret-token" });
      expect(config.app).toBe("https://bupulse.example");
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "Kigali Kicks 11111111-1111-4111-8111-111111111111" }), { status: 500 }));
      await expect(api(config, "claim", {}, fetchImpl)).rejects.toThrow();
      await expect(api(config, "claim", {}, vi.fn(async () => Promise.reject(new Error("getaddrinfo bupulse.example"))))).rejects.toThrow();
      expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>).authorization).toBe("Bearer s3cret-token");
    } finally {
      spy.mockRestore();
    }
    expect(lines).toEqual(["[video-robot] The app answered with an error; status: call claim, status 500", "[video-robot] Could not reach the app."]);
    for (const bit of SECRET_BITS) expect(lines.join("\n")).not.toContain(bit);
  });

  it("is not configured without both the URL and the secret, and keeps limits in range", () => {
    expect(settings({}).configured).toBe(false);
    expect(settings({ ROBOT_APP_URL: "https://x.example" }).configured).toBe(false);
    expect(settings({ VIDEO_ROBOT_SECRET: "s" }).configured).toBe(false);
    const c = settings({ ROBOT_APP_URL: "https://x.example", VIDEO_ROBOT_SECRET: "s", ROBOT_CONCURRENCY: "9", ROBOT_BUDGET_MS: "99999999" });
    expect(c.configured).toBe(true);
    expect(c.concurrency).toBe(2);
    expect(c.budgetMs).toBeLessThanOrEqual(19 * 60_000);
  });
});
