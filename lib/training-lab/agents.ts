// The agent team inside BuPulse (docs/TRAINING_LAB.md, "The agent team inside BuPulse"): the ten members, each with one
// job, the Lab kinds it learns from and the "brains" it may run on. The owner's choice of brain is saved in AgentSetting
// (brains.ts); with no choice a member uses its default. Pure and shared by the server and the Admin page.
import type { TrainingEngine, TrainingKind } from "./types";

export const BRAINS = ["gemini", "anthropic", "claude-subscription", "rules"] as const;
export type Brain = (typeof BRAINS)[number];

export const BRAIN_LABELS: Record<Brain, string> = {
  gemini: "Gemini (API key)",
  anthropic: "Claude (API key)",
  "claude-subscription": "Claude (your subscription, this Mac only)",
  rules: "Rules (free, no AI)",
};

export const AGENT_IDS = ["researcher", "director", "script-writer", "designer", "caption-writer", "painter", "filmmaker", "editor", "checker", "scheduler"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type Agent = {
  id: AgentId;
  name: string;
  /** What it does, in plain words. */
  job: string;
  /** The engine it belongs to, in words. */
  engine: string;
  files: string[];
  /** The Lab example kinds it learns from (none: it only works from the business's own facts). */
  reads: TrainingKind[];
  /**
   * The Lab engine switches (on each example) whose examples it reads, with its kinds: the writers read Kinyarwanda
   * phrases through "language", the painter actors through "presenter". Empty when it reads none.
   */
  engines: TrainingEngine[];
  /** The brains it can run on. */
  brains: Brain[];
  defaultBrain: Brain;
  /** The order tried when the chosen brain is not available or fails (the chosen brain first). */
  fallback: Brain[];
  /** Its default work costs money per call (capped elsewhere). */
  paid: boolean;
};

const WRITERS: Brain[] = ["anthropic", "claude-subscription", "gemini", "rules"];

export const AGENTS: readonly Agent[] = [
  { id: "researcher", name: "Researcher", job: "Collects the business, its products and photos, and the owner's brief.", engine: "Image engine facts", files: ["lib/image-engine/engine.ts"], reads: [], engines: [], brains: ["rules"], defaultBrain: "rules", fallback: ["rules"], paid: false },
  { id: "director", name: "Director", job: "Picks the story, the shots, the camera and the viral recipe.", engine: "Reel, image and video brain", files: ["lib/reel-engine/story.ts", "lib/image-engine/director.ts", "lib/video-engine/brain/viral.ts"], reads: ["reel", "video", "image"], engines: ["video", "reel", "image"], brains: ["rules", "anthropic", "claude-subscription", "gemini"], defaultBrain: "rules", fallback: ["rules"], paid: false },
  { id: "script-writer", name: "Script writer", job: "Writes the reel's lines, title, caption and hashtags.", engine: "Reel engine", files: ["lib/reel-engine/writer.ts"], reads: ["reel", "video", "voice"], engines: ["reel", "video", "language"], brains: WRITERS, defaultBrain: "anthropic", fallback: WRITERS, paid: true },
  { id: "designer", name: "Designer", job: "Thinks up each image or post: the idea, the headline and the layout.", engine: "Image engine", files: ["lib/image-engine/planner.ts", "lib/image-engine/prompter.ts"], reads: ["image"], engines: ["image", "post"], brains: WRITERS, defaultBrain: "anthropic", fallback: WRITERS, paid: true },
  { id: "caption-writer", name: "Caption writer", job: "Writes post captions and hashtags.", engine: "Image engine and Autopilot", files: ["lib/image-engine/captioner.ts", "lib/autopilot/writer.ts"], reads: ["image", "voice"], engines: ["post", "language"], brains: ["gemini", "anthropic", "claude-subscription", "rules"], defaultBrain: "gemini", fallback: ["gemini", "anthropic", "claude-subscription", "rules"], paid: true },
  { id: "painter", name: "Painter", job: "Paints the start frames and the images.", engine: "Image engine (Nano Banana)", files: ["lib/image-engine/engine.ts"], reads: ["image", "actor"], engines: ["image", "presenter"], brains: ["gemini"], defaultBrain: "gemini", fallback: ["gemini"], paid: true },
  { id: "filmmaker", name: "Filmmaker", job: "Films the AI clips from the start frames.", engine: "Video engine (Veo)", files: ["lib/video-engine/veo.ts"], reads: [], engines: [], brains: ["gemini"], defaultBrain: "gemini", fallback: ["gemini"], paid: true },
  { id: "editor", name: "Editor", job: "Cuts the clips on the beat and adds stickers and captions, into the MP4.", engine: "Reel engine and the Lab editor", files: ["lib/reel-engine/story.ts", "lib/editor/ops.ts"], reads: ["reel", "video"], engines: ["reel", "video"], brains: ["rules"], defaultBrain: "rules", fallback: ["rules"], paid: false },
  { id: "checker", name: "Checker", job: "Watches and reads the result and sends back what is wrong.", engine: "Reel and image checks, language check", files: ["lib/reel-engine/checker.ts", "lib/image-engine/checker.ts", "lib/video-engine/brain/language.ts"], reads: ["reel", "video", "image", "voice"], engines: ["reel", "video", "image", "language"], brains: ["gemini", "rules"], defaultBrain: "gemini", fallback: ["gemini", "rules"], paid: true },
  { id: "scheduler", name: "Scheduler", job: "Decides when and how often to post on each network.", engine: "Autopilot and publishing", files: ["lib/autopilot/learning.ts", "lib/autopilot/planner.ts", "lib/publishing/best-time.ts"], reads: ["schedule"], engines: ["schedule"], brains: ["rules"], defaultBrain: "rules", fallback: ["rules"], paid: false },
];

export const isBrain = (v: unknown): v is Brain => typeof v === "string" && (BRAINS as readonly string[]).includes(v);
export const isAgentId = (v: unknown): v is AgentId => typeof v === "string" && (AGENT_IDS as readonly string[]).includes(v);
export const agentById = (id: string): Agent | null => AGENTS.find((a) => a.id === id) ?? null;

/** The brains to try, in order: the chosen one (when this member can use it), else its default, then its fallback order. */
export function brainChain(agent: Agent, saved: string | null | undefined): Brain[] {
  const first = isBrain(saved) && agent.brains.includes(saved) ? saved : agent.defaultBrain;
  return [...new Set([first, ...agent.fallback])].filter((b) => agent.brains.includes(b));
}

/** The brain a member runs on now: the first of its chain that is available, or null when none is. */
export function chooseBrain(agent: Agent, saved: string | null | undefined, available: (brain: Brain) => boolean): Brain | null {
  return brainChain(agent, saved).find(available) ?? null;
}
