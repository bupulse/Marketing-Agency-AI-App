// The Prompter's AI calls (docs/IMAGE_ENGINE.md). Owner decision (23 October 2026): Claude and Gemini both write, in
// parallel, each for its share of the batch's slots, so two minds give more different ideas. Claude runs on the API key
// when there is one, else on the owner's subscription on the test site only (claude-cli.ts); Gemini Flash always.
// When one fails, the other writes the missing slots; when both fail, the rules do (prompter.ts ruleConcept), so a
// batch never stops here. Every API call goes through the cost ledger (feature "imageEngine").
import "server-only";
import { getTextProvider } from "@/lib/ai";
import { ClaudeTextProvider } from "@/lib/ai/claude-text";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { logError } from "@/lib/errors";
import { isServiceEnabled } from "@/lib/admin/switch";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { runText, savedBrain } from "@/lib/training-lab/brains";
import { recordRun } from "@/lib/training-lab/runs";
import type { AgentId, Brain } from "@/lib/training-lab/agents";
import { claudeBySubscription, SUBSCRIPTION_MODEL, subscriptionAllowed } from "./claude-cli";
import { PLANNER_JSON_SCHEMA, PLANNER_SYSTEM, plannerPrompt, readConcepts, ruleConcept, type Concept, type PlannerInput } from "./prompter";

export const ENGINE_FEATURE = "imageEngine";
const CLAUDE_API_MODEL = "claude-sonnet-5-5";

export type Writer = "gemini" | "claude" | "rules";
export type PlannedConcept = Concept & { planner: Writer };
type Owner = { userId: string; businessId: string };
/** For the agent team's run log (lib/training-lab/runs.ts): the Lab examples read and what the call makes ("batch:<id>"). */
export type TeamRef = { exampleIds?: string[]; resultRef?: string | null };

/**
 * One AI call by a team member, logged in the run log whatever happens (the brain really used, model, time, cost when
 * the usage is known). `ok`: the answer gave something usable. Logging never fails the call; errors are rethrown.
 */
export async function logged<T>(agentId: AgentId, owner: Owner, team: TeamRef, brain: Brain, call: () => Promise<{ value: T; ok: boolean; model?: string | null; costUsd?: number }>): Promise<T> {
  const started = Date.now();
  const base = { agentId, brain, feature: ENGINE_FEATURE, businessId: owner.businessId, exampleIds: team.exampleIds ?? [], resultRef: team.resultRef ?? null };
  try {
    const r = await call();
    await recordRun({ ...base, model: r.model ?? null, ok: r.ok, ms: Date.now() - started, costUsd: r.costUsd ?? 0, error: r.ok ? null : "The answer had nothing usable." });
    return r.value;
  } catch (error) {
    await recordRun({ ...base, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const parse = (text: string) => {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
};

async function geminiWrite(owner: Owner, input: PlannerInput, team: TeamRef = {}): Promise<(Concept | null)[]> {
  const provider = getTextProvider();
  return logged("designer", owner, team, provider.name === "claude" ? "anthropic" : "gemini", async () => {
    const result = await withLedger(
      { ...owner, feature: ENGINE_FEATURE },
      { provider: provider.name, model: provider.name === "claude" ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5") : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL) },
      () => provider.generate({ system: PLANNER_SYSTEM, prompt: plannerPrompt(input), jsonSchema: PLANNER_JSON_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 900 * input.slots.length + 500 }),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );
    const value = readConcepts(parse(result.text), input);
    return { value, ok: value.some(Boolean), model: result.model, costUsd: estimateCostUsd(result.model, result.usage) };
  });
}

/** Which Claude the Prompter may use here: the API, the owner's subscription (test site only), or none. */
export async function claudeRoute(): Promise<"api" | "subscription" | null> {
  if (!(await isServiceEnabled("claude").catch(() => false))) return null;
  if (process.env.ANTHROPIC_API_KEY) return "api";
  return subscriptionAllowed() ? "subscription" : null;
}

/**
 * One JSON answer from Claude through the route allowed here (the API key, else the owner's subscription on the test
 * site only), for the engines' writers (also the reel engine). Null when Claude cannot be used here.
 */
export async function claudeJson(owner: Owner, system: string, prompt: string, schema: object, feature = ENGINE_FEATURE): Promise<string | null> {
  const route = await claudeRoute();
  if (!route) return null;
  if (route === "subscription") return (await claudeBySubscription(system, prompt, schema)).text;
  const provider = new ClaudeTextProvider(process.env.ANTHROPIC_API_KEY!, CLAUDE_API_MODEL, "low");
  const result = await withLedger({ ...owner, feature }, { provider: "claude", model: CLAUDE_API_MODEL }, () => provider.generate({ system, prompt, jsonSchema: schema as Record<string, unknown>, maxOutputTokens: 4000 }), (r) => ({ provider: r.provider, model: r.model, usage: r.usage }));
  return result.text;
}

async function claudeWrite(owner: Owner, input: PlannerInput, route: "api" | "subscription", team: TeamRef = {}): Promise<(Concept | null)[]> {
  if (route === "api") {
    return logged("designer", owner, team, "anthropic", async () => {
      const provider = new ClaudeTextProvider(process.env.ANTHROPIC_API_KEY!, CLAUDE_API_MODEL, "low");
      const result = await withLedger(
        { ...owner, feature: ENGINE_FEATURE },
        { provider: "claude", model: CLAUDE_API_MODEL },
        () => provider.generate({ system: PLANNER_SYSTEM, prompt: plannerPrompt(input), jsonSchema: PLANNER_JSON_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 900 * input.slots.length + 500 }),
        (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
      );
      const value = readConcepts(parse(result.text), input);
      return { value, ok: value.some(Boolean), model: result.model, costUsd: estimateCostUsd(result.model, result.usage) };
    });
  }
  // The subscription bills nothing per call, so there is no ledger row (the owner's own testing).
  return logged("designer", owner, team, "claude-subscription", async () => {
    const result = await claudeBySubscription(PLANNER_SYSTEM, plannerPrompt(input), PLANNER_JSON_SCHEMA);
    const value = readConcepts(parse(result.text), input);
    return { value, ok: value.some(Boolean), model: SUBSCRIPTION_MODEL, costUsd: 0 };
  });
}

/**
 * The Designer on the owner's saved brain (Training Lab team, lib/training-lab/brains.ts runText, which logs its own
 * runs): one call for every slot; the rules fill what it leaves, and all of them when the router has no answer.
 */
async function routedConcepts(owner: Owner, input: PlannerInput, team: TeamRef): Promise<PlannedConcept[]> {
  let concepts: (Concept | null)[] = input.slots.map(() => null);
  let writer: Writer = "rules";
  try {
    const run = await runText("designer", { system: PLANNER_SYSTEM, prompt: plannerPrompt(input), jsonSchema: PLANNER_JSON_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 900 * input.slots.length + 500, feature: ENGINE_FEATURE, owner, exampleIds: team.exampleIds, resultRef: team.resultRef });
    if (run) {
      concepts = readConcepts(parse(run.text), input);
      writer = run.brain === "gemini" ? "gemini" : "claude";
    } else {
      await recordRun({ agentId: "designer", brain: "rules", feature: ENGINE_FEATURE, businessId: owner.businessId, ok: true, exampleIds: team.exampleIds ?? [], resultRef: team.resultRef ?? null });
    }
  } catch (error) {
    await logError(error, { source: "image-engine.designer", level: "warn", businessId: owner.businessId });
  }
  return concepts.map((c, i) => (c ? { ...c, planner: writer } : { ...ruleConcept(input.slots[i], input), planner: "rules" as const }));
}

/**
 * One concept per slot, in order. With two writers, Claude takes the first half (the Pro pictures come first) and
 * Gemini the rest, both told the whole batch's slots are theirs to keep apart; a writer's gaps go to the other one.
 */
export async function writeConcepts(owner: Owner, input: PlannerInput, options: { only?: "gemini" } & TeamRef = {}): Promise<PlannedConcept[]> {
  const team: TeamRef = { exampleIds: options.exampleIds, resultRef: options.resultRef };
  // The owner's brain switch for the Designer (the Team page): one brain for every slot. Without a saved choice it works
  // as it always has, Claude and Gemini each writing their share (that split is not one brain, so it stays here).
  if (await savedBrain("designer")) return routedConcepts(owner, input, team);
  const route = options.only === "gemini" ? null : await claudeRoute();
  const n = input.slots.length;
  const split = route ? Math.ceil(n / 2) : 0;
  const part = (from: number, to: number): PlannerInput => ({ ...input, slots: input.slots.slice(from, to) });
  const safely = async (writer: "gemini" | "claude", run: () => Promise<(Concept | null)[]>, size: number) => {
    try {
      return await run();
    } catch (error) {
      await logError(error, { source: `image-engine.${writer}`, level: "warn", businessId: owner.businessId });
      return Array<Concept | null>(size).fill(null);
    }
  };
  const [claude, gemini] = await Promise.all([
    split > 0 ? safely("claude", () => claudeWrite(owner, part(0, split), route!, team), split) : Promise.resolve([] as (Concept | null)[]),
    split < n ? safely("gemini", () => geminiWrite(owner, part(split, n), team), n - split) : Promise.resolve([] as (Concept | null)[]),
  ]);
  const out: (PlannedConcept | null)[] = [...claude.map((c) => (c ? { ...c, planner: "claude" as const } : null)), ...gemini.map((c) => (c ? { ...c, planner: "gemini" as const } : null))];

  // Gaps: the other writer tries them once, told what the batch already has; then the rules fill what is left.
  const gaps = out.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (gaps.length) {
    const taken = out.filter((c): c is PlannedConcept => !!c).map((c) => `${c.title}: ${c.scene}`.slice(0, 200));
    const retry: PlannerInput = { ...input, slots: gaps.map((i) => input.slots[i]), recent: [...taken, ...input.recent] };
    const useClaude = route && gemini.some((c) => !c) && !claude.some((c) => !c);
    const filled = await safely(useClaude ? "claude" : "gemini", () => (useClaude ? claudeWrite(owner, retry, route!, team) : geminiWrite(owner, retry, team)), gaps.length);
    gaps.forEach((slotIndex, k) => {
      const c = filled[k];
      out[slotIndex] = c ? { ...c, planner: useClaude ? "claude" : "gemini" } : { ...ruleConcept(input.slots[slotIndex], input), planner: "rules" };
    });
  }
  return out as PlannedConcept[];
}
