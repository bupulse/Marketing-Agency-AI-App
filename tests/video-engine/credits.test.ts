import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const WALLET = path.resolve("video-lab/data/wallet.json");
let saved: string | null = null;

beforeEach(async () => {
  saved = await fs.readFile(WALLET, "utf8").catch(() => null);
  await fs.rm(WALLET, { force: true });
});
afterEach(async () => {
  if (saved === null) await fs.rm(WALLET, { force: true });
  else await fs.writeFile(WALLET, saved);
});

describe("studio credits", () => {
  it("prices Seedance clips from the estimate with a margin, rounded to 5, never under 5", async () => {
    const { seedanceCredits, CLAUDE_VIDEO_CREDITS, PRESENTER_IMAGE_CREDITS } = await import("@/video-lab/credits");
    expect(seedanceCredits("pro", "720p", 5) % 5).toBe(0);
    expect(seedanceCredits("pro", "1080p", 5)).toBeGreaterThan(seedanceCredits("pro", "720p", 5));
    expect(seedanceCredits("mini", "480p", 4)).toBeGreaterThanOrEqual(5);
    expect(seedanceCredits("fast", "720p", 10)).toBeGreaterThan(seedanceCredits("fast", "720p", 5));
    expect(CLAUDE_VIDEO_CREDITS).toBeGreaterThan(0);
    expect(PRESENTER_IMAGE_CREDITS).toBeGreaterThan(0);
  });

  it("charges, refuses when short, refunds and tops up", async () => {
    const { charge, readWallet, refund, topUp } = await import("@/video-lab/credits");
    const start = (await readWallet()).balance;
    await charge(100, "test", "j1");
    expect((await readWallet()).balance).toBe(start - 100);
    await expect(charge(start * 10, "too much")).rejects.toThrow(/Not enough credits/);
    await refund(100, "back", "j1");
    expect((await readWallet()).balance).toBe(start);
    await topUp(50, "pack");
    const w = await readWallet();
    expect(w.balance).toBe(start + 50);
    expect(w.history.at(-1)).toMatchObject({ delta: 50, note: "pack" });
  });
});
