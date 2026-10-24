import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  audits: [] as { action: string; target: string | null; before: unknown; after: unknown }[],
  queryRaw: vi.fn(),
  settings: [] as { agentId: string; brain: string }[],
  upsert: vi.fn(async () => ({})),
}));

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (_db: unknown, _ctx: unknown, action: string, target: string | null, before: unknown, after: unknown) => {
    m.audits.push({ action, target, before, after });
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: m.queryRaw,
    agentSetting: {
      findMany: vi.fn(async () => m.settings),
      findUnique: vi.fn(async ({ where }: { where: { agentId: string } }) => m.settings.find((s) => s.agentId === where.agentId) ?? null),
      upsert: m.upsert,
    },
  },
}));

const team = await import("@/app/admin/(console)/(ai)/training-lab/team/data");
const { AGENTS, AGENT_IDS, agentById } = await import("@/lib/training-lab/agents");
const ctx = { actor: "admin", ip: null, viaApi: false };
const OWNER = { id: "0b6f3c1e-1111-4222-8333-444455556666", isOwner: true, staffId: null };
const agent = (id: string) => agentById(id)!;

beforeEach(() => {
  m.audits.length = 0;
  m.settings = [];
  m.upsert.mockClear();
  m.queryRaw.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "g");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("IMAGE_ENGINE_CLAUDE_SUBSCRIPTION", "");
  vi.stubEnv("PLATFORM", "node");
});
afterEach(() => vi.unstubAllEnvs());

describe("examples a member can read", () => {
  const groups = [
    { kind: "reel", engines: ["reel", "video"], consentGiven: false, count: 3 },
    { kind: "voice", engines: ["language"], consentGiven: false, count: 2 },
    { kind: "image", engines: ["image"], consentGiven: false, count: 4 },
    { kind: "image", engines: [], consentGiven: false, count: 9 },
    { kind: "actor", engines: ["presenter"], consentGiven: true, count: 1 },
    { kind: "actor", engines: ["presenter"], consentGiven: false, count: 5 },
    { kind: "schedule", engines: ["schedule"], consentGiven: false, count: 2 },
  ];

  it("counts its kinds switched on for one of its engines, once each", () => {
    expect(team.examplesFor(agent("script-writer"), groups)).toBe(5); // 3 reels + 2 recordings
    expect(team.examplesFor(agent("designer"), groups)).toBe(4); // switched-off images do not count
    expect(team.examplesFor(agent("scheduler"), groups)).toBe(2);
    expect(team.examplesFor(agent("researcher"), groups)).toBe(0);
  });

  it("counts an actor only with consent", () => {
    expect(team.examplesFor(agent("painter"), groups)).toBe(4 + 1);
  });

  it("has Lab engines for every member", () => {
    for (const id of AGENT_IDS) expect(team.AGENT_ENGINES[id]).toBeDefined();
    for (const a of AGENTS) if (a.reads.length) expect(team.AGENT_ENGINES[a.id].length).toBeGreaterThan(0);
  });
});

describe("brains here", () => {
  it("says in plain words why a brain cannot be used", () => {
    expect(team.unavailableNote("gemini")).toBeNull();
    expect(team.unavailableNote("anthropic")).toBe("Anthropic key: not set");
    expect(team.unavailableNote("claude-subscription")).toBe("Claude subscription: only on the owner's Mac, with the switch on");
    expect(team.unavailableNote("rules")).toBeNull();
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(team.unavailableNote("gemini")).toBe("Gemini key: not set");
  });

  it("never offers the subscription on Netlify", () => {
    vi.stubEnv("IMAGE_ENGINE_CLAUDE_SUBSCRIPTION", "1");
    expect(team.unavailableNote("claude-subscription")).toBeNull();
    vi.stubEnv("PLATFORM", "netlify");
    expect(team.unavailableNote("claude-subscription")).not.toBeNull();
  });

  it("marks the paid brains", () => {
    const opts = team.brainOptions(agent("script-writer"));
    expect(opts.map((o) => [o.brain, o.paid, o.available])).toEqual([
      ["anthropic", true, false],
      ["claude-subscription", false, false],
      ["gemini", true, true],
      ["rules", false, true],
    ]);
  });
});

describe("teamCards", () => {
  it("lists every member in pipeline order with its count, choice and the brain it really uses", async () => {
    m.queryRaw.mockResolvedValue([{ kind: "reel", engines: ["reel"], consentGiven: false, count: 2 }]);
    m.settings = [{ agentId: "designer", brain: "gemini" }, { agentId: "checker", brain: "nonsense" }];
    const cards = await team.teamCards();
    expect(cards.map((c) => c.agent.id)).toEqual([...AGENT_IDS]);
    const writer = cards.find((c) => c.agent.id === "script-writer")!;
    // Its default is the Anthropic key, which is not set here: it falls back to Gemini.
    expect(writer).toMatchObject({ examples: 2, saved: null, chosen: "anthropic", using: "gemini" });
    expect(cards.find((c) => c.agent.id === "designer")).toMatchObject({ saved: "gemini", chosen: "gemini", using: "gemini" });
    expect(cards.find((c) => c.agent.id === "checker")).toMatchObject({ saved: null, chosen: "gemini" });
    expect(m.queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("setAgentBrain", () => {
  it("is for the owner only", async () => {
    await expect(team.setAgentBrain(ctx, { ...OWNER, staffId: "s1" }, "designer", "gemini")).rejects.toMatchObject({ code: "forbidden" });
    await expect(team.setAgentBrain({ ...ctx, viaApi: true }, OWNER, "designer", "gemini")).rejects.toMatchObject({ code: "forbidden" });
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("refuses an unknown member or a brain it cannot use", async () => {
    await expect(team.setAgentBrain(ctx, OWNER, "boss", "gemini")).rejects.toThrow("That team member does not exist.");
    await expect(team.setAgentBrain(ctx, OWNER, "painter", "anthropic")).rejects.toThrow("Painter cannot use that brain.");
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("saves, audits the change and says what it runs on", async () => {
    m.settings = [{ agentId: "designer", brain: "anthropic" }];
    expect(await team.setAgentBrain(ctx, OWNER, "designer", "gemini")).toBe("Designer now works on Gemini (API key).");
    expect(m.upsert).toHaveBeenCalledWith({ where: { agentId: "designer" }, create: { agentId: "designer", brain: "gemini", updatedById: OWNER.id }, update: { brain: "gemini", updatedById: OWNER.id } });
    expect(m.audits).toEqual([{ action: "set_agent_brain", target: "agent:designer", before: { brain: "anthropic" }, after: { brain: "gemini" } }]);
  });

  it("says when the chosen brain is not available here", async () => {
    expect(await team.setAgentBrain(ctx, OWNER, "designer", "claude-subscription")).toBe("Saved. Claude (your subscription, this Mac only) is not available here, so Designer uses Gemini (API key) for now.");
  });
});
