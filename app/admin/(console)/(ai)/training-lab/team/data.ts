import "server-only";
// The Team page's data (docs/TRAINING_LAB.md, "The agent team inside BuPulse"): per member, how many Lab examples it can
// read now, the brains it may use and whether each works here, the brain it really runs on, and saving the owner's
// choice with an audit row. The registry, the router and the run log stay in lib/training-lab (agents, brains, runs).
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { AGENTS, BRAIN_LABELS, agentById, chooseBrain, isAgentId, isBrain, type Agent, type AgentId, type Brain } from "@/lib/training-lab/agents";
import { brainAvailable, saveBrain } from "@/lib/training-lab/brains";
import { assertLabOwner, type LabOwner } from "@/lib/training-lab/examples";
import type { TrainingEngine } from "@/lib/training-lab/types";

/**
 * The Lab engines (the switches on each example) whose examples a member reads, alongside its kinds. Matches what each
 * member's engine asks reader.ts for: the writers read Kinyarwanda phrases through "language", the painter actors
 * through "presenter".
 */
export const AGENT_ENGINES: Record<AgentId, TrainingEngine[]> = {
  researcher: [],
  director: ["video", "reel", "image"],
  "script-writer": ["reel", "video", "language"],
  designer: ["image", "post"],
  "caption-writer": ["post", "language"],
  painter: ["image", "presenter"],
  filmmaker: [],
  editor: ["reel", "video"],
  checker: ["reel", "video", "image", "language"],
  scheduler: ["schedule"],
};

/** One group of identical examples (same kind, engines and consent) and how many there are. */
export type ExampleGroup = { kind: string; engines: string[]; consentGiven: boolean; count: number };

/** The examples a member can read now: of its kinds, switched on for one of its engines, and an actor only with consent. */
export function examplesFor(agent: Agent, groups: ExampleGroup[]): number {
  const engines = AGENT_ENGINES[agent.id] as string[];
  return groups
    .filter((g) => (agent.reads as string[]).includes(g.kind) && g.engines.some((e) => engines.includes(e)) && (g.kind !== "actor" || g.consentGiven))
    .reduce((sum, g) => sum + g.count, 0);
}

/** Every example grouped by kind, engines and consent, in one query. */
export async function exampleGroups(): Promise<ExampleGroup[]> {
  const rows = await prisma.$queryRaw<{ kind: string; engines: string[] | null; consentGiven: boolean; count: number }[]>`
    SELECT "kind", "engines", "consentGiven", COUNT(*)::int AS "count" FROM "TrainingExample" GROUP BY "kind", "engines", "consentGiven"`;
  return rows.map((r) => ({ kind: r.kind, engines: r.engines ?? [], consentGiven: r.consentGiven, count: Number(r.count) }));
}

export type BrainOption = { brain: Brain; label: string; available: boolean; note: string | null; paid: boolean };

/** Why a brain cannot be used here, in plain words, or null when it can. */
export function unavailableNote(brain: Brain): string | null {
  if (brainAvailable(brain)) return null;
  switch (brain) {
    case "gemini":
      return "Gemini key: not set";
    case "anthropic":
      return "Anthropic key: not set";
    case "claude-subscription":
      return "Claude subscription: only on the owner's Mac, with the switch on";
    case "rules":
      return null;
  }
}

export const isPaidBrain = (brain: Brain) => brain === "gemini" || brain === "anthropic";

export function brainOptions(agent: Agent): BrainOption[] {
  return agent.brains.map((brain) => {
    const note = unavailableNote(brain);
    return { brain, label: BRAIN_LABELS[brain], available: note === null, note, paid: isPaidBrain(brain) };
  });
}

export type MemberCard = { agent: Agent; examples: number; saved: Brain | null; chosen: Brain; using: Brain | null; options: BrainOption[] };

/** Every member in pipeline order with its examples, its brains and the brain it runs on now (as brainFor decides). */
export async function teamCards(): Promise<MemberCard[]> {
  const [groups, settings] = await Promise.all([exampleGroups(), prisma.agentSetting.findMany({ select: { agentId: true, brain: true } })]);
  const savedOf = new Map(settings.map((s) => [s.agentId, s.brain]));
  return AGENTS.map((agent) => {
    const raw = savedOf.get(agent.id);
    const saved = isBrain(raw) && agent.brains.includes(raw) ? raw : null;
    return {
      agent,
      examples: examplesFor(agent, groups),
      saved,
      chosen: saved ?? agent.defaultBrain,
      // The same choice as brainFor (lib/training-lab/brains.ts), from the settings read once for the whole team.
      using: chooseBrain(agent, saved, brainAvailable),
      options: brainOptions(agent),
    };
  });
}

/** Saves the owner's brain for a member and audits it; says what it runs on now when that brain is not available here. */
export async function setAgentBrain(ctx: AdminContext, identity: LabOwner, agentId: string, brain: string): Promise<string> {
  assertLabOwner(ctx, identity);
  if (!isAgentId(agentId)) throw new AdminError("invalid", "That team member does not exist.");
  const agent = agentById(agentId)!;
  if (!isBrain(brain) || !agent.brains.includes(brain)) throw new AdminError("invalid", `${agent.name} cannot use that brain.`);
  const before = (await prisma.agentSetting.findUnique({ where: { agentId }, select: { brain: true } }))?.brain ?? null;
  if (!(await saveBrain(agentId, brain, identity.id))) throw new AdminError("invalid", `${agent.name} cannot use that brain.`);
  await writeAudit(prisma, ctx, "set_agent_brain", `agent:${agentId}`, { brain: before }, { brain });
  const using = chooseBrain(agent, brain, brainAvailable);
  if (using === brain) return `${agent.name} now works on ${BRAIN_LABELS[brain]}.`;
  return `Saved. ${BRAIN_LABELS[brain]} is not available here, so ${agent.name} uses ${using ? BRAIN_LABELS[using] : "nothing"} for now.`;
}
