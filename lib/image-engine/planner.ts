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
import { claudeBySubscription, subscriptionAllowed } from "./claude-cli";
import { PLANNER_JSON_SCHEMA, PLANNER_SYSTEM, plannerPrompt, readConcepts, ruleConcept, type Concept, type PlannerInput } from "./prompter";

export const ENGINE_FEATURE = "imageEngine";
const CLAUDE_API_MODEL = "claude-sonnet-5-5";

export type Writer = "gemini" | "claude" | "rules";
export type PlannedConcept = Concept & { planner: Writer };
type Owner = { userId: string; businessId: string };

const parse = (text: string) => {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
};

async function geminiWrite(owner: Owner, input: PlannerInput): Promise<(Concept | null)[]> {
  const provider = getTextProvider();
  const result = await withLedger(
    { ...owner, feature: ENGINE_FEATURE },
    { provider: provider.name, model: provider.name === "claude" ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5") : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL) },
    () => provider.generate({ system: PLANNER_SYSTEM, prompt: plannerPrompt(input), jsonSchema: PLANNER_JSON_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 900 * input.slots.length + 500 }),
    (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
  );
  return readConcepts(parse(result.text), input);
}

/** Which Claude the Prompter may use here: the API, the owner's subscription (test site only), or none. */
export async function claudeRoute(): Promise<"api" | "subscription" | null> {
  if (!(await isServiceEnabled("claude").catch(() => false))) return null;
  if (process.env.ANTHROPIC_API_KEY) return "api";
  return subscriptionAllowed() ? "subscription" : null;
}

async function claudeWrite(owner: Owner, input: PlannerInput, route: "api" | "subscription"): Promise<(Concept | null)[]> {
  if (route === "api") {
    const provider = new ClaudeTextProvider(process.env.ANTHROPIC_API_KEY!, CLAUDE_API_MODEL, "low");
    const result = await withLedger(
      { ...owner, feature: ENGINE_FEATURE },
      { provider: "claude", model: CLAUDE_API_MODEL },
      () => provider.generate({ system: PLANNER_SYSTEM, prompt: plannerPrompt(input), jsonSchema: PLANNER_JSON_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 900 * input.slots.length + 500 }),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );
    return readConcepts(parse(result.text), input);
  }
  // The subscription bills nothing per call, so there is no ledger row (the owner's own testing).
  const result = await claudeBySubscription(PLANNER_SYSTEM, plannerPrompt(input), PLANNER_JSON_SCHEMA);
  return readConcepts(parse(result.text), input);
}

/**
 * One concept per slot, in order. With two writers, Claude takes the first half (the Pro pictures come first) and
 * Gemini the rest, both told the whole batch's slots are theirs to keep apart; a writer's gaps go to the other one.
 */
export async function writeConcepts(owner: Owner, input: PlannerInput, options: { only?: "gemini" } = {}): Promise<PlannedConcept[]> {
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
    split > 0 ? safely("claude", () => claudeWrite(owner, part(0, split), route!), split) : Promise.resolve([] as (Concept | null)[]),
    split < n ? safely("gemini", () => geminiWrite(owner, part(split, n)), n - split) : Promise.resolve([] as (Concept | null)[]),
  ]);
  const out: (PlannedConcept | null)[] = [...claude.map((c) => (c ? { ...c, planner: "claude" as const } : null)), ...gemini.map((c) => (c ? { ...c, planner: "gemini" as const } : null))];

  // Gaps: the other writer tries them once, told what the batch already has; then the rules fill what is left.
  const gaps = out.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (gaps.length) {
    const taken = out.filter((c): c is PlannedConcept => !!c).map((c) => `${c.title}: ${c.scene}`.slice(0, 200));
    const retry: PlannerInput = { ...input, slots: gaps.map((i) => input.slots[i]), recent: [...taken, ...input.recent] };
    const useClaude = route && gemini.some((c) => !c) && !claude.some((c) => !c);
    const filled = await safely(useClaude ? "claude" : "gemini", () => (useClaude ? claudeWrite(owner, retry, route!) : geminiWrite(owner, retry)), gaps.length);
    gaps.forEach((slotIndex, k) => {
      const c = filled[k];
      out[slotIndex] = c ? { ...c, planner: useClaude ? "claude" : "gemini" } : { ...ruleConcept(input.slots[slotIndex], input), planner: "rules" };
    });
  }
  return out as PlannedConcept[];
}
