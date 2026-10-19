import { z } from "zod";

// An automation is a graph drawn on the canvas (components/automations/canvas): one trigger node and steps joined by
// lines. This file is shared by the canvas (browser) and the engine (server): the node types, their settings, the
// checks done before publishing and how to find the next step. docs/AUTOMATIONS.md describes each step in plain words.

export const CHANNELS = ["WEBSITE", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "TELEGRAM"] as const;
export type Channel = (typeof CHANNELS)[number];

export const TRIGGER_KINDS = ["keyword", "comment_keyword", "any_comment", "story_mention", "first_message", "default_reply"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  keyword: "Message contains a keyword",
  comment_keyword: "Comment contains a keyword",
  any_comment: "Any comment on a post",
  story_mention: "Mentions you in a Story",
  first_message: "First message from someone new",
  default_reply: "Any message no other automation answers",
};

/** Comment triggers need a channel with comments. */
export const COMMENT_TRIGGERS: TriggerKind[] = ["comment_keyword", "any_comment"];
export const COMMENT_CHANNELS: Channel[] = ["INSTAGRAM", "FACEBOOK"];

const id = z.string().min(1).max(40);
const text = (max: number) => z.string().max(max);

export const buttonSchema = z.object({ id, title: text(20).min(1), url: z.string().url().max(500).optional().or(z.literal("").transform(() => undefined)) });
export type Button = z.infer<typeof buttonSchema>;

export const triggerDataSchema = z.object({
  kind: z.enum(TRIGGER_KINDS),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length).default([]),
  keywords: z.array(text(60)).max(30).default([]),
  /** "contains": the keyword anywhere in the text; "exact": the whole message is the keyword. Case and accents never matter. */
  match: z.enum(["contains", "exact"]).default("contains"),
  /** Comment triggers: only these posts (platform ids); empty = every post. */
  postIds: z.array(text(80)).max(50).default([]),
  /** Comment triggers: public replies under the comment, one picked at random ("Sent you a DM!"). */
  publicReplies: z.array(text(300)).max(5).default([]),
});
export type TriggerData = z.infer<typeof triggerDataSchema>;

export const messageDataSchema = z.object({
  text: text(1000),
  buttons: z.array(buttonSchema).max(3).default([]),
  imageUrl: z.string().url().max(500).optional(),
});

export const QUESTION_SAVE = ["name", "email", "phone", "field"] as const;
export const questionDataSchema = z.object({
  text: text(1000),
  saveTo: z.enum(QUESTION_SAVE).default("field"),
  /** For saveTo "field": the contact field key. */
  fieldKey: text(40).optional(),
  validate: z.enum(["any", "email", "phone", "number"]).default("any"),
  retryText: text(300).default(""),
  /** No answer after this many minutes follows the "No answer" line; 0 waits for ever. */
  timeoutMinutes: z.number().int().min(0).max(60 * 24 * 7).default(0),
  quickReplies: z.array(text(20)).max(10).default([]),
});

export const aiDataSchema = z.object({
  /** What the AI should achieve, in the owner's words ("Find out which size they need and send the price"). */
  goal: text(500),
  /** Extra facts for this automation only, on top of the knowledge base. */
  context: text(4000).default(""),
  /** Replies before moving on along "Done". */
  maxTurns: z.number().int().min(1).max(10).default(3),
});

export const CONDITION_KINDS = ["has_tag", "no_tag", "field_equals", "field_set", "has_email", "has_phone", "channel_is", "text_contains"] as const;
export const conditionRuleSchema = z.object({
  kind: z.enum(CONDITION_KINDS),
  value: text(120).default(""),
  key: text(40).default(""),
});
export const conditionDataSchema = z.object({
  rules: z.array(conditionRuleSchema).min(1).max(10),
  /** "all": every rule must be true; "any": one is enough. */
  mode: z.enum(["all", "any"]).default("all"),
});
export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const ACTION_KINDS = ["add_tag", "remove_tag", "set_field", "notify_team", "save_lead", "subscribe_email", "unsubscribe", "webhook"] as const;
export const actionSchema = z.object({
  kind: z.enum(ACTION_KINDS),
  tag: text(40).default(""),
  key: text(40).default(""),
  value: text(500).default(""),
});
export const actionDataSchema = z.object({ actions: z.array(actionSchema).min(1).max(10) });
export type Action = z.infer<typeof actionSchema>;

export const waitDataSchema = z.object({ minutes: z.number().int().min(1).max(60 * 24 * 30) });

export const handoverDataSchema = z.object({
  /** Shown to the person ("Someone from our team will answer you shortly"). */
  text: text(500).default(""),
  /** The team note shown in the inbox. */
  note: text(300).default(""),
  /** Hours the automations and AI stay quiet in this conversation. */
  pauseHours: z.number().int().min(1).max(24 * 7).default(24),
});

export const NODE_TYPES = ["trigger", "message", "question", "ai", "condition", "action", "wait", "handover", "end"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_LABELS: Record<NodeType, string> = {
  trigger: "When",
  message: "Send a message",
  question: "Ask a question",
  ai: "AI conversation",
  condition: "Condition",
  action: "Actions",
  wait: "Wait",
  handover: "Hand over to the team",
  end: "End",
};

const position = z.object({ x: z.number().finite(), y: z.number().finite() });
export const nodeSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("trigger"), position, data: triggerDataSchema }),
  z.object({ id, type: z.literal("message"), position, data: messageDataSchema }),
  z.object({ id, type: z.literal("question"), position, data: questionDataSchema }),
  z.object({ id, type: z.literal("ai"), position, data: aiDataSchema }),
  z.object({ id, type: z.literal("condition"), position, data: conditionDataSchema }),
  z.object({ id, type: z.literal("action"), position, data: actionDataSchema }),
  z.object({ id, type: z.literal("wait"), position, data: waitDataSchema }),
  z.object({ id, type: z.literal("handover"), position, data: handoverDataSchema }),
  z.object({ id, type: z.literal("end"), position, data: z.object({}).default({}) }),
]);
export type GraphNode = z.infer<typeof nodeSchema>;
export type NodeOf<T extends NodeType> = Extract<GraphNode, { type: T }>;

/** `sourceHandle` picks the exit: "next", a button id, "answered" / "no_answer", "yes" / "no", "done". */
export const edgeSchema = z.object({ id, source: id, target: id, sourceHandle: z.string().max(40).nullish() });
export type GraphEdge = z.infer<typeof edgeSchema>;

export const MAX_NODES = 60;
export const graphSchema = z.object({ nodes: z.array(nodeSchema).min(1).max(MAX_NODES), edges: z.array(edgeSchema).max(MAX_NODES * 4) });
export type Graph = z.infer<typeof graphSchema>;

/** The exits a node has, in the order the canvas draws them. */
export function exitsOf(node: GraphNode): { handle: string; label: string }[] {
  switch (node.type) {
    case "end":
      return [];
    case "message": {
      const tapped = node.data.buttons.filter((b) => !b.url).map((b) => ({ handle: b.id, label: b.title || "Button" }));
      return [{ handle: "next", label: tapped.length ? "Next (no tap needed)" : "Next" }, ...tapped];
    }
    case "question":
      return [
        { handle: "answered", label: "Answered" },
        ...(node.data.timeoutMinutes > 0 ? [{ handle: "no_answer", label: "No answer" }] : []),
      ];
    case "condition":
      return [
        { handle: "yes", label: "Yes" },
        { handle: "no", label: "No" },
      ];
    case "ai":
      return [{ handle: "done", label: "Done" }];
    default:
      return [{ handle: "next", label: "Next" }];
  }
}

/** The node an exit leads to, or null when nothing is connected. */
export function nextNodeId(graph: Pick<Graph, "edges">, nodeId: string, handle = "next"): string | null {
  const edge = graph.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? "next") === handle);
  return edge?.target ?? null;
}

export function triggerOf(graph: Pick<Graph, "nodes">): NodeOf<"trigger"> | null {
  return (graph.nodes.find((n) => n.type === "trigger") as NodeOf<"trigger"> | undefined) ?? null;
}

export type GraphProblem = { nodeId?: string; message: string };

/** What stops an automation from going live, in plain words. An empty list means it can be published. */
export function graphProblems(graph: Graph): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) problems.push({ message: triggers.length ? "An automation has exactly one trigger." : "Add a trigger: what starts this automation." });
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) problems.push({ message: "Two steps have the same id. Delete one and add it again." });
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) problems.push({ message: "A line points to a step that no longer exists. Delete the line." });
    if (e.source === e.target) problems.push({ nodeId: e.source, message: "A step cannot lead to itself." });
  }
  const trigger = triggers[0] as NodeOf<"trigger"> | undefined;
  if (trigger) {
    const t = trigger.data;
    if (!t.channels.length) problems.push({ nodeId: trigger.id, message: "Choose at least one channel for the trigger." });
    if ((t.kind === "keyword" || t.kind === "comment_keyword") && !t.keywords.some((k) => k.trim())) {
      problems.push({ nodeId: trigger.id, message: "Add at least one keyword." });
    }
    if (COMMENT_TRIGGERS.includes(t.kind) && t.channels.some((c) => !COMMENT_CHANNELS.includes(c))) {
      problems.push({ nodeId: trigger.id, message: "Comment triggers work on Instagram and Facebook only." });
    }
    if (t.kind === "story_mention" && t.channels.some((c) => c !== "INSTAGRAM")) {
      problems.push({ nodeId: trigger.id, message: "Story mentions exist on Instagram only." });
    }
    if (!nextNodeId(graph, trigger.id)) problems.push({ nodeId: trigger.id, message: "Connect the trigger to a first step." });
  }
  for (const n of graph.nodes) {
    if (n.type === "message" && !n.data.text.trim()) problems.push({ nodeId: n.id, message: "This message is empty." });
    if (n.type === "question") {
      if (!n.data.text.trim()) problems.push({ nodeId: n.id, message: "Write the question." });
      if (n.data.saveTo === "field" && !n.data.fieldKey) problems.push({ nodeId: n.id, message: "Choose the contact field the answer is saved in." });
    }
    if (n.type === "ai" && !n.data.goal.trim()) problems.push({ nodeId: n.id, message: "Tell the AI what to achieve." });
    if (n.type === "action") {
      for (const a of n.data.actions) {
        if ((a.kind === "add_tag" || a.kind === "remove_tag") && !a.tag.trim()) problems.push({ nodeId: n.id, message: "Choose the tag." });
        if (a.kind === "set_field" && !a.key) problems.push({ nodeId: n.id, message: "Choose the field to set." });
      }
    }
  }
  // Every step must be reachable from the trigger: a forgotten step usually means a missing line.
  if (trigger) {
    const seen = new Set<string>([trigger.id]);
    const queue = [trigger.id];
    while (queue.length) {
      const at = queue.shift()!;
      for (const e of graph.edges) if (e.source === at && !seen.has(e.target)) (seen.add(e.target), queue.push(e.target));
    }
    for (const n of graph.nodes) if (!seen.has(n.id)) problems.push({ nodeId: n.id, message: "This step is not connected to the trigger." });
  }
  return problems;
}

/** Reads a stored graph; a broken one becomes null (the editor then starts from an empty trigger). */
export function readGraph(value: unknown): Graph | null {
  const parsed = graphSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A new automation: a trigger alone in the middle of the canvas. */
export function emptyGraph(kind: TriggerKind = "keyword", channels: Channel[] = ["WEBSITE"]): Graph {
  return {
    nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: triggerDataSchema.parse({ kind, channels }) }],
    edges: [],
  };
}
