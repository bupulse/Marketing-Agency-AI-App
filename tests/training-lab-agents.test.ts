import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { agentSetting: { findUnique: (...a: unknown[]) => findUnique(...a), upsert: vi.fn() } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
const subscription = vi.fn(() => false);
vi.mock("@/lib/image-engine/claude-cli", () => ({ subscriptionAllowed: () => subscription(), claudeBySubscription: vi.fn(), SUBSCRIPTION_MODEL: "claude-sonnet-5-5" }));

import { AGENTS, AGENT_IDS, BRAINS, brainChain, chooseBrain } from "@/lib/training-lab/agents";
import { brainAvailable, brainFor, runText } from "@/lib/training-lab/brains";
import { ENGINES, KINDS } from "@/lib/training-lab/types";

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(null);
  subscription.mockReturnValue(false);
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

describe("registry", () => {
  it("has the ten members once each", () => {
    expect(AGENTS.map((a) => a.id)).toEqual([...AGENT_IDS]);
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(10);
  });
  it("gives every member a valid job, kinds and brains", () => {
    for (const a of AGENTS) {
      expect(a.name.length).toBeGreaterThan(2);
      expect(a.job.length).toBeGreaterThan(10);
      expect(a.files.length).toBeGreaterThan(0);
      expect(a.reads.every((k) => (KINDS as readonly string[]).includes(k))).toBe(true);
      expect(a.brains.length).toBeGreaterThan(0);
      expect(a.brains.every((b) => (BRAINS as readonly string[]).includes(b))).toBe(true);
      expect(a.brains).toContain(a.defaultBrain);
      expect(a.fallback[0]).toBe(a.defaultBrain);
      expect(a.fallback.every((b) => a.brains.includes(b))).toBe(true);
      expect(a.engines.every((e) => (ENGINES as readonly string[]).includes(e))).toBe(true);
      // A member that reads Lab kinds reads them through at least one engine switch, and one that reads none has none.
      expect(a.engines.length > 0).toBe(a.reads.length > 0);
    }
  });
  it("marks as wired the script writer, the designer, the caption writer and the members with one brain", () => {
    expect(AGENTS.filter((a) => a.wired).map((a) => a.id)).toEqual(["researcher", "script-writer", "designer", "caption-writer", "painter", "filmmaker", "editor", "scheduler"]);
    for (const a of AGENTS) if (a.brains.length === 1) expect(a.wired).toBe(true);
  });
  it("reads Kinyarwanda phrases through the language switch and actors through the presenter switch", () => {
    for (const a of AGENTS) if (a.reads.includes("voice")) expect(a.engines).toContain("language");
    expect(AGENTS.find((a) => a.id === "painter")?.engines).toContain("presenter");
    expect(AGENTS.find((a) => a.id === "script-writer")?.engines).toEqual(["reel", "video", "language"]);
  });
  it("keeps the free members on rules and never gives the paid painter or filmmaker a free brain", () => {
    for (const id of ["researcher", "editor", "scheduler"]) expect(AGENTS.find((a) => a.id === id)).toMatchObject({ defaultBrain: "rules", paid: false });
    expect(AGENTS.find((a) => a.id === "painter")?.brains).toEqual(["gemini"]);
    expect(AGENTS.find((a) => a.id === "filmmaker")?.brains).toEqual(["gemini"]);
  });
});

describe("brainChain and chooseBrain", () => {
  const writer = AGENTS.find((a) => a.id === "script-writer")!;
  it("starts with the saved brain, else the default", () => {
    expect(brainChain(writer, "gemini")[0]).toBe("gemini");
    expect(brainChain(writer, null)[0]).toBe("anthropic");
    expect(brainChain(writer, "nonsense")[0]).toBe("anthropic");
    expect(new Set(brainChain(writer, "gemini")).size).toBe(brainChain(writer, "gemini").length);
  });
  it("ignores a saved brain the member cannot use", () => {
    const painter = AGENTS.find((a) => a.id === "painter")!;
    expect(brainChain(painter, "rules")).toEqual(["gemini"]);
  });
  it("takes the first available, or null", () => {
    expect(chooseBrain(writer, null, (b) => b === "gemini")).toBe("gemini");
    expect(chooseBrain(AGENTS.find((a) => a.id === "painter")!, null, () => false)).toBeNull();
  });
});

describe("brains", () => {
  it("knows what is available from the environment", () => {
    expect(brainAvailable("rules")).toBe(true);
    expect(brainAvailable("gemini")).toBe(false);
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("ANTHROPIC_API_KEY", "y");
    subscription.mockReturnValue(true);
    expect(["gemini", "anthropic", "claude-subscription"].every((b) => brainAvailable(b as never))).toBe(true);
  });
  it("falls back to the next available brain", async () => {
    expect(await brainFor("script-writer")).toBe("rules");
    vi.stubEnv("GEMINI_API_KEY", "x");
    expect(await brainFor("script-writer")).toBe("gemini");
    subscription.mockReturnValue(true);
    expect(await brainFor("script-writer")).toBe("claude-subscription");
    vi.stubEnv("ANTHROPIC_API_KEY", "y");
    expect(await brainFor("script-writer")).toBe("anthropic");
  });
  it("uses the saved brain when it is available, else falls on", async () => {
    findUnique.mockResolvedValue({ agentId: "script-writer", brain: "gemini" });
    vi.stubEnv("ANTHROPIC_API_KEY", "y");
    expect(await brainFor("script-writer")).toBe("anthropic");
    vi.stubEnv("GEMINI_API_KEY", "x");
    expect(await brainFor("script-writer")).toBe("gemini");
  });
  it("uses the default when the database fails, and null for the painter without a key", async () => {
    findUnique.mockRejectedValue(new Error("down"));
    vi.stubEnv("ANTHROPIC_API_KEY", "y");
    expect(await brainFor("script-writer")).toBe("anthropic");
    expect(await brainFor("painter")).toBeNull();
  });
  it("runText gives null when no AI brain is available or the member runs on rules", async () => {
    expect(await runText("script-writer", { system: "s", prompt: "p", feature: "test" })).toBeNull();
    expect(await runText("scheduler", { system: "s", prompt: "p", feature: "test" })).toBeNull();
  });
});
