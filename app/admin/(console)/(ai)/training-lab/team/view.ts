// What the Team page shows, as small pure helpers: the two pipelines at the top, the short names of the brains, the Free or
// Paid chip and the "learns from" line of a card. The facts come from agents.ts and data.ts; this only chooses the words.
import { AGENTS, type AgentId, type Brain } from "@/lib/training-lab/agents";
import type { MemberCard } from "./data";

/** How a reel is made, in order, and the members a post adds. */
export const REEL_PIPELINE: AgentId[] = ["researcher", "director", "script-writer", "painter", "filmmaker", "editor", "checker"];
export const POST_PIPELINE: AgentId[] = ["designer", "caption-writer", "scheduler"];

export const SHORT_BRAIN: Record<Brain, string> = { gemini: "Gemini", anthropic: "Claude key", "claude-subscription": "Your subscription", rules: "Rules" };

/** Every member of the registry appears in a pipeline exactly once. */
export const pipelineCovers = () => [...REEL_PIPELINE, ...POST_PIPELINE].sort().join() === AGENTS.map((a) => a.id).sort().join();

/** "Paid" when the brain it works on costs per call, else "Free" (a member on rules, or the subscription, costs nothing per call). */
export function costChip(card: Pick<MemberCard, "agent" | "using" | "defaultNote">): "Free" | "Paid" {
  const brain = card.using;
  if (card.defaultNote || !brain) return card.agent.paid ? "Paid" : "Free";
  return brain === "gemini" || brain === "anthropic" ? "Paid" : "Free";
}

/** "Learns from 3 examples", or why it learns from none. */
export function learnsLine(card: Pick<MemberCard, "agent" | "examples">): string {
  if (card.agent.reads.length === 0) return "Works from the business's own facts";
  return `Learns from ${card.examples} example${card.examples === 1 ? "" : "s"}`;
}
