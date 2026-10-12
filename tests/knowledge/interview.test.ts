import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory MarketingInterview row and Business, so the service's flow runs for real with the AI mocked.
const m = vi.hoisted(() => {
  const state: { row: Record<string, unknown> | null; business: Record<string, unknown>; tick: number } = { row: null, business: {}, tick: 0 };
  const stamp = () => new Date(1_700_000_000_000 + ++state.tick);
  return {
    state,
    generate: vi.fn(),
    rateLimit: vi.fn(),
    logError: vi.fn(),
    providerError: null as null | (() => Error),
    prisma: {
      marketingInterview: {
        findUnique: vi.fn(async () => (state.row ? { ...state.row } : null)),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          state.row = state.row ? { ...state.row, ...update, updatedAt: stamp() } : { id: "i1", ...create, updatedAt: stamp() };
          return state.row;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { updatedAt?: Date }; data: Record<string, unknown> }) => {
          if (!state.row || (where.updatedAt && (state.row.updatedAt as Date).getTime() !== where.updatedAt.getTime())) return { count: 0 };
          state.row = { ...state.row, ...data, updatedAt: stamp() };
          return { count: 1 };
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.row = { ...state.row, ...data, updatedAt: stamp() };
          return state.row;
        }),
      },
      business: {
        findUnique: vi.fn(async () => ({ name: "Kigali Bakes", industry: "Food", description: "A bakery", profile: null, contentLanguage: "English", ...state.business })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.business = { ...state.business, ...data };
          return state.business;
        }),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/errors", () => ({ logError: m.logError }));
vi.mock("@/lib/rate-limit", async () => ({ ...(await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")), rateLimit: m.rateLimit }));
vi.mock("@/lib/ai", () => ({
  getCheapTextProvider: () => {
    if (m.providerError) throw m.providerError();
    return { provider: { name: "gemini", generate: m.generate }, model: "gemini-3.1-flash-lite" };
  },
}));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));

import { AIBudgetExceededError } from "@/lib/ai/budget";
import { AIProviderError } from "@/lib/ai/types";
import {
  checkAnswer,
  fallbackSummary,
  fixedQuestion,
  followupAllowed,
  interviewCompleteness,
  MAX_QUESTIONS,
  nextFixedQuestion,
  parseAiQuestion,
  readMarketingProfile,
  readSteps,
  TOPIC_KEYS,
  type InterviewStep,
} from "@/lib/knowledge/interview";
import { answerStep, approveProfile, getInterviewView, startInterview, stepBack } from "@/lib/knowledge/interview-service";
import { RateLimitError } from "@/lib/rate-limit";

const ctx = { userId: "u1", businessId: "b1" };
const aiJson = (q: Record<string, unknown>) => ({ text: JSON.stringify({ done: false, multi: false, ...q }), provider: "gemini", model: "gemini-3.1-flash-lite", usage: { inputTokens: 10, outputTokens: 10 } });
const answered = (topics: string[]): InterviewStep[] => topics.map((t) => ({ ...fixedQuestion(t as never), answer: { choices: [fixedQuestion(t as never).options[0]], other: null }, skipped: false }));

/** Answers the question on screen with its first option. */
async function answerCurrent() {
  const view = await getInterviewView("b1");
  const step = view.steps[view.cursor];
  await answerStep(ctx, { index: view.cursor, choices: [step.options[0]], other: "", skip: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.row = null;
  m.state.business = {};
  m.providerError = null;
  m.rateLimit.mockResolvedValue(undefined);
  m.generate.mockReset();
});

describe("interview rules (pure)", () => {
  it("accepts an adaptive AI question on a topic not covered yet and drops an 'Other' option", () => {
    const steps = answered(["tone"]);
    const q = parseAiQuestion(JSON.stringify({ done: false, topic: "emojis", question: "You picked warm and friendly: how many emojis feel right?", options: ["None", "One or two", "A few", "Other"], multi: false }), steps);
    expect(q).toEqual({ topic: "emojis", question: "You picked warm and friendly: how many emojis feel right?", options: ["None", "One or two", "A few"], multi: false, source: "ai" });
  });

  it("refuses an AI question on a covered topic, a repeat, too few options, bad JSON or an early 'done'", () => {
    const steps = answered(["tone"]);
    const base = { done: false, topic: "emojis", question: "How many emojis?", options: ["a", "b", "c"], multi: false };
    expect(parseAiQuestion(JSON.stringify({ ...base, topic: "tone" }), steps)).toBeNull();
    expect(parseAiQuestion(JSON.stringify({ ...base, question: steps[0].question }), steps)).toBeNull();
    expect(parseAiQuestion(JSON.stringify({ ...base, options: ["a", "a", "b"] }), steps)).toBeNull();
    expect(parseAiQuestion("not json", steps)).toBeNull();
    expect(parseAiQuestion(JSON.stringify({ ...base, done: true }), steps)).toBeNull();
    expect(parseAiQuestion(JSON.stringify({ ...base, topic: "made-up" }), steps)).toBeNull();
  });

  it("allows a follow-up only while every remaining topic still fits under the target", () => {
    expect(followupAllowed(answered(["tone"]))).toBe(true);
    const all = answered(TOPIC_KEYS.slice(0, 13));
    expect(followupAllowed(all)).toBe(true); // 13 asked + 1 left < 15
    expect(followupAllowed([...all, { ...all[0], topic: "followup", question: "Why?" }])).toBe(false); // 14 + 1 = 15
    const followup = JSON.stringify({ done: false, topic: "followup", question: "Which emoji do you like most?", options: ["a", "b", "c"], multi: false });
    expect(parseAiQuestion(followup, answered(["tone"]))).toMatchObject({ topic: "followup" });
  });

  it("checks answers against the question's own options", () => {
    const q = fixedQuestion("tone");
    expect(checkAnswer(q, { choices: [q.options[0]], other: "" })).toEqual({ ok: true, answer: { choices: [q.options[0]], other: null } });
    expect(checkAnswer(q, { choices: ["Rude"], other: "" }).ok).toBe(false);
    expect(checkAnswer(q, { choices: [q.options[0], q.options[1]], other: "" }).ok).toBe(false); // single choice
    expect(checkAnswer(q, { choices: [], other: "" }).ok).toBe(false);
    expect(checkAnswer(q, { choices: [], other: "Like a big sister <<<x>>>" })).toEqual({ ok: true, answer: { choices: [], other: "Like a big sister x" } });
    const multi = fixedQuestion("channels");
    expect(checkAnswer(multi, { choices: multi.options.slice(0, 3), other: "Radio" }).ok).toBe(true);
  });

  it("runs the fixed set in order and stops at the cap", () => {
    expect(nextFixedQuestion([])?.topic).toBe("tone");
    expect(nextFixedQuestion(answered(["tone", "personality"]))?.topic).toBe("values");
    expect(nextFixedQuestion(answered(TOPIC_KEYS))).toBeNull();
    const twenty = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ ...fixedQuestion("tone"), topic: "followup" as const, question: `Q${i}`, answer: null, skipped: true }));
    expect(nextFixedQuestion(twenty)).toBeNull();
    expect(readSteps([...twenty, ...twenty])).toHaveLength(MAX_QUESTIONS);
  });

  it("writes a usable summary without the AI", () => {
    const s = fallbackSummary(answered(["tone", "personality", "emojis", "never"]));
    expect(s.voice).toContain("Sound warm and friendly.");
    expect(s.do.join(" ")).toContain("Emojis: No emojis");
    expect(s.dont.join(" ")).toContain("Never say:");
  });

  it("scores the section", () => {
    expect(interviewCompleteness(null, null).percent).toBe(0);
    expect(interviewCompleteness(null, { status: "review", steps: [] }).percent).toBe(90);
    expect(interviewCompleteness({ voice: "x", do: [], dont: [], samples: [], answers: [], approvedAt: "" }, null).percent).toBe(100);
  });
});

describe("interview flow (AI mocked)", () => {
  it("starts with the fixed tone question, then asks the AI's adaptive question", async () => {
    await startInterview("b1");
    let view = await getInterviewView("b1");
    expect(view).toMatchObject({ status: "active", cursor: 0 });
    expect(view.steps[0]).toMatchObject({ topic: "tone", source: "fixed" });
    expect(m.generate).not.toHaveBeenCalled();

    m.generate.mockResolvedValueOnce(aiJson({ topic: "emojis", question: "Warm and friendly it is! How many emojis fit Kigali Bakes?", options: ["None", "One or two", "Plenty"] }));
    await answerCurrent();
    view = await getInterviewView("b1");
    expect(view.cursor).toBe(1);
    expect(view.steps[1]).toMatchObject({ topic: "emojis", source: "ai", question: "Warm and friendly it is! How many emojis fit Kigali Bakes?" });
    // The AI saw the earlier answer, fenced as data.
    const prompt = m.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("<<<ANSWERS");
    expect(prompt).toContain("Warm and friendly");
    expect(m.rateLimit).toHaveBeenCalledWith("interviewAi:b1", expect.anything());
    expect(m.state.row!.aiCalls).toBe(1);
  });

  it("falls back to the next fixed question when the AI answer is unusable, and keeps trying the AI", async () => {
    await startInterview("b1");
    m.generate.mockResolvedValueOnce({ text: "sorry", provider: "gemini", model: "x", usage: { inputTokens: 1, outputTokens: 1 } });
    await answerCurrent();
    let view = await getInterviewView("b1");
    expect(view.steps[1]).toMatchObject({ topic: "personality", source: "fixed" });
    expect(view.mode).toBe("ai");

    m.generate.mockRejectedValueOnce(new AIProviderError("busy", "gemini", true));
    await answerCurrent();
    view = await getInterviewView("b1");
    expect(view.steps[2]).toMatchObject({ topic: "values", source: "fixed" });
    expect(view.mode).toBe("ai"); // a passing failure does not switch the interview off
  });

  it("switches to the fixed set for good when the budget is reached, the key is missing or the rate limit hits", async () => {
    await startInterview("b1");
    m.generate.mockRejectedValueOnce(new AIBudgetExceededError("gemini"));
    await answerCurrent();
    expect((await getInterviewView("b1")).mode).toBe("fixed");
    await answerCurrent();
    expect(m.generate).toHaveBeenCalledTimes(1); // no more AI calls

    await startInterview("b1");
    m.providerError = () => new Error("GEMINI_API_KEY is not set");
    await answerCurrent();
    expect((await getInterviewView("b1")).mode).toBe("fixed");

    m.providerError = null;
    await startInterview("b1");
    m.rateLimit.mockRejectedValueOnce(new RateLimitError(60));
    await answerCurrent();
    const view = await getInterviewView("b1");
    expect(view.mode).toBe("fixed");
    expect(view.steps[1].source).toBe("fixed");
  });

  it("covers every topic with the fixed set, then writes the summary (fallback when the AI is off)", async () => {
    m.providerError = () => new Error("no key");
    await startInterview("b1");
    for (let i = 0; i < TOPIC_KEYS.length; i++) await answerCurrent();
    const view = await getInterviewView("b1");
    expect(view.steps).toHaveLength(TOPIC_KEYS.length);
    expect(view.status).toBe("review");
    expect(view.summary?.voice).toContain("Sound warm and friendly.");
  });

  it("never asks more than the hard cap, even when the AI keeps asking follow-ups", async () => {
    await startInterview("b1");
    let n = 0;
    m.generate.mockImplementation(async () => aiJson({ topic: "followup", question: `Follow-up number ${++n}?`, options: ["a", "b", "c"] }));
    for (let i = 0; i < 40 && (await getInterviewView("b1")).status === "active"; i++) await answerCurrent();
    const view = await getInterviewView("b1");
    expect(view.status).toBe("review");
    expect(view.steps.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(new Set(view.steps.filter((s) => s.topic !== "followup").map((s) => s.topic)).size).toBe(TOPIC_KEYS.length);
  });

  it("lets the owner skip and go back; answering an earlier question again keeps the later ones", async () => {
    m.providerError = () => new Error("no key");
    await startInterview("b1");
    const first = await getInterviewView("b1");
    await answerStep(ctx, { index: 0, choices: [], other: "", skip: true });
    await answerCurrent();
    let view = await getInterviewView("b1");
    expect(view.steps[0].skipped).toBe(true);
    expect(view.cursor).toBe(2);

    await stepBack("b1");
    await stepBack("b1");
    view = await getInterviewView("b1");
    expect(view.cursor).toBe(0);
    await answerStep(ctx, { index: 0, choices: [first.steps[0].options[1]], other: "", skip: false });
    view = await getInterviewView("b1");
    expect(view.cursor).toBe(1);
    expect(view.steps).toHaveLength(3);
    expect(view.steps[0]).toMatchObject({ skipped: false, answer: { choices: [first.steps[0].options[1]] } });
  });

  it("refuses an answer to a question that is not the one on screen (a stale tab)", async () => {
    await startInterview("b1");
    await expect(answerStep(ctx, { index: 3, choices: [], other: "", skip: true })).rejects.toThrow(/another tab/);
  });

  it("uses the AI summary, and approval writes the brand voice the writers read", async () => {
    m.state.row = {
      id: "i1",
      businessId: "b1",
      status: "active",
      mode: "ai",
      steps: [...answered(TOPIC_KEYS.slice(0, -1)), { ...fixedQuestion("style"), answer: null, skipped: false }],
      cursor: TOPIC_KEYS.length - 1,
      aiCalls: 3,
      summary: null,
      updatedAt: new Date(1),
    };
    m.generate.mockResolvedValueOnce({ text: JSON.stringify({ voice: "Warm, local and proud.", do: ["Mention Kigali"], dont: ["No slang"], samples: ["Fresh from our oven."] }), provider: "gemini", model: "x", usage: { inputTokens: 1, outputTokens: 1 } });
    await answerCurrent();
    let view = await getInterviewView("b1");
    expect(view.status).toBe("review");
    expect(view.summary).toEqual({ voice: "Warm, local and proud.", do: ["Mention Kigali"], dont: ["No slang"], samples: ["Fresh from our oven."] });
    expect(m.generate.mock.calls[0][0].system).toContain("brand-voice guide");

    await approveProfile("b1", { voice: "Warm and proud (edited).", do: ["Mention Kigali"], dont: [], samples: [] });
    const profile = readMarketingProfile(m.state.business.marketingProfile);
    expect(profile).toMatchObject({ voice: "Warm and proud (edited).", do: ["Mention Kigali"] });
    expect(profile!.answers).toHaveLength(TOPIC_KEYS.length);
    view = await getInterviewView("b1");
    expect(view.status).toBe("approved");
  });
});
