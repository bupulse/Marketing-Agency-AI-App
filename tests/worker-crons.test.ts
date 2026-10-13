import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The schedules live in worker-crons.ts (worker.ts imports the OpenNext build output); read the files as text.
const wrangler = readFileSync("wrangler.jsonc", "utf8");
const worker = readFileSync("worker-crons.ts", "utf8");

const triggers = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(wrangler)![1]) as string[];
const schedules = [...worker.matchAll(/export const \w+_CRON = "([^"]+)"/g)].map((m) => m[1]);

describe("Cloudflare cron schedules", () => {
  it("every trigger in wrangler.jsonc has a route in worker.ts", () => {
    expect(triggers.filter((t) => !schedules.includes(t))).toEqual([]);
  });

  it("every schedule in worker.ts is triggered by wrangler.jsonc", () => {
    expect(schedules.filter((s) => !triggers.includes(s))).toEqual([]);
  });

  it("worker.ts exports nothing but its handler and the Durable Object classes (workerd refuses plain values)", () => {
    const main = readFileSync("worker.ts", "utf8");
    expect(main).not.toMatch(/^export (const|let|function|async function|class) /m);
    expect([...main.matchAll(/^export \{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim()))).toEqual(["BucketCachePurge", "DOQueueHandler", "DOShardedTagCache"]);
  });

  it("has no duplicate schedules (each maps to one route)", () => {
    expect(new Set(schedules).size).toBe(schedules.length);
  });
});
