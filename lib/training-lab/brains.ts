// The brain router for the agent team (agents.ts): which brain a member runs on now, and one text call on it that falls
// back to the next brain when one fails. It reuses the engines' own callers: the Gemini and Claude text providers, the
// owner's Claude subscription (image-engine/claude-cli.ts) and the cost ledger. API calls are recorded in the ledger under the
// feature the caller gives (its schema is not changed) and every attempt in our own run log (runs.ts). Keys are never logged.
import "server-only";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { ClaudeTextProvider } from "@/lib/ai/claude-text";
import { DEFAULT_GEMINI_TEXT_FALLBACK, DEFAULT_GEMINI_TEXT_MODEL, GeminiTextProvider } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { AIBudgetExceededError } from "@/lib/ai/budget";
import { isServiceEnabled, ServiceDisabledError } from "@/lib/admin/switch";
import { claudeBySubscription, SUBSCRIPTION_MODEL, subscriptionAllowed } from "@/lib/image-engine/claude-cli";

// The Team page asks this too; only this file and the image engine's planner may import claude-cli
// (tests/video-engine/no-subscription-transport.test.ts).
export { subscriptionAllowed };
import { recordRun } from "./runs";
import { agentById, brainChain, chooseBrain, isBrain, type Agent, type AgentId, type Brain } from "./agents";

const CLAUDE_API_MODEL = "claude-sonnet-5-5";

/** Whether a brain can be used here now (keys are only checked for being set). */
export function brainAvailable(brain: Brain): boolean {
  switch (brain) {
    case "gemini":
      return !!process.env.GEMINI_API_KEY;
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "claude-subscription":
      return subscriptionAllowed();
    case "rules":
      return true;
  }
}

/** The owner's saved brain for a member, or null (never throws: no database means the default). */
export async function savedBrain(agentId: AgentId): Promise<Brain | null> {
  try {
    const row = await prisma.agentSetting.findUnique({ where: { agentId } });
    return row && isBrain(row.brain) ? row.brain : null;
  } catch {
    return null;
  }
}

/** Saves the owner's choice; false when the member cannot use that brain. */
export async function saveBrain(agentId: AgentId, brain: Brain, adminId: string): Promise<boolean> {
  const agent = agentById(agentId);
  if (!agent || !agent.brains.includes(brain)) return false;
  await prisma.agentSetting.upsert({ where: { agentId }, create: { agentId, brain, updatedById: adminId }, update: { brain, updatedById: adminId } });
  return true;
}

/** The brain a member runs on now: its saved choice, else its default, then the first available in its fallback order. */
export async function brainFor(agentId: AgentId): Promise<Brain | null> {
  const agent = agentById(agentId);
  if (!agent) return null;
  return chooseBrain(agent, await savedBrain(agentId), brainAvailable);
}

export type TextCall = { system: string; prompt: string; jsonSchema?: Record<string, unknown>; maxOutputTokens?: number; feature: string; owner?: { userId?: string | null; businessId?: string | null };
  /** The TrainingExample ids the member read for this call, and what it makes ("reel:<id>"), for the run log. */
  exampleIds?: string[];
  resultRef?: string | null;
};
export type TextRun = { text: string; brain: Brain; model: string; costUsd: number };

async function runOn(brain: "gemini" | "anthropic" | "claude-subscription", call: TextCall): Promise<TextRun> {
  const request = { system: call.system, prompt: call.prompt, jsonSchema: call.jsonSchema, maxOutputTokens: call.maxOutputTokens ?? 4000 };
  const context = { userId: call.owner?.userId ?? null, businessId: call.owner?.businessId ?? null, feature: call.feature };
  if (brain === "claude-subscription") {
    // The subscription bills nothing per call, so there is no ledger row (as in the image engine's Prompter).
    const r = await claudeBySubscription(call.system, call.prompt, call.jsonSchema ?? { type: "object" });
    return { text: r.text, brain, model: SUBSCRIPTION_MODEL, costUsd: 0 };
  }
  if (brain === "anthropic") {
    const provider = new ClaudeTextProvider(process.env.ANTHROPIC_API_KEY!, CLAUDE_API_MODEL, "low");
    const r = await withLedger(context, { provider: "claude", model: CLAUDE_API_MODEL }, () => provider.generate(request), (x) => ({ provider: x.provider, model: x.model, usage: x.usage }));
    return { text: r.text, brain, model: r.model, costUsd: estimateCostUsd(r.model, r.usage) };
  }
  const model = process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL;
  const provider = new GeminiTextProvider(process.env.GEMINI_API_KEY!, model, process.env.GEMINI_TEXT_FALLBACK_MODEL ?? DEFAULT_GEMINI_TEXT_FALLBACK);
  const r = await withLedger(context, { provider: "gemini", model }, () => provider.generate(request), (x) => ({ provider: x.provider, model: x.model, usage: x.usage }));
  return { text: r.text, brain, model: r.model, costUsd: estimateCostUsd(r.model, r.usage) };
}

/** The brains that cost money per call. */
const PAID: ReadonlySet<Brain> = new Set(["gemini", "anthropic"]);

/** A stop that applies to the whole request, not to one brain: the AI budget (platform or company) or a provider switched off. */
const isStop = (error: unknown) => error instanceof AIBudgetExceededError || error instanceof ServiceDisabledError;

/**
 * One text answer for a member, on its brain; on an error (or a brain that is not available) the next brain in its
 * order. Null when it reaches "rules" or runs out of brains: the caller then uses its own rules.
 * - A budget stop (AIBudgetExceededError, CompanyBudgetExceededError) or a switched-off provider (ServiceDisabledError) is
 *   rethrown, not passed to another provider: every caller (the reel writer, the Designer, the Caption writer) already
 *   catches errors from here and falls back to its own rules, and a budget stays a stop.
 * - After a paid brain fails for any other reason, only free brains are tried (the subscription, then rules), so one
 *   request is never paid for twice.
 * - The subscription is used only while the admin "claude" switch is on, as the image engine's claudeRoute does.
 */
export async function runText(agentId: AgentId, call: TextCall): Promise<TextRun | null> {
  const agent: Agent | null = agentById(agentId);
  if (!agent) return null;
  let paidFailed = false;
  for (const brain of brainChain(agent, await savedBrain(agentId))) {
    if (brain === "rules") return null;
    if (!brainAvailable(brain)) continue;
    if (paidFailed && PAID.has(brain)) continue;
    if (brain === "claude-subscription" && !(await isServiceEnabled("claude").catch(() => false))) continue;
    const started = Date.now();
    const log = { agentId, brain, feature: call.feature, businessId: call.owner?.businessId ?? null, exampleIds: call.exampleIds, resultRef: call.resultRef };
    try {
      const run = await runOn(brain, call);
      await recordRun({ ...log, model: run.model, ok: true, ms: Date.now() - started, costUsd: run.costUsd });
      return run;
    } catch (error) {
      await logError(error, { source: `training-lab.agent.${agentId}.${brain}`, level: "warn", businessId: call.owner?.businessId ?? undefined });
      await recordRun({ ...log, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
      if (isStop(error)) throw error;
      if (PAID.has(brain)) paidFailed = true;
    }
  }
  return null;
}
