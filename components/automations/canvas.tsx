"use client";

import { applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, MiniMap, Position, ReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/cn";
import { NODE_LABELS, TRIGGER_LABELS, exitsOf, type GraphNode } from "@/lib/automations/graph";
import { CHANNEL_LABELS } from "@/lib/inbox/labels";
import { ICONS } from "./icons";

// The React Flow canvas of the automation editor (editor.tsx). It is loaded in the browser only (next/dynamic, ssr:
// false): React Flow draws nothing before it has measured the page, and keeping it out of the server bundle keeps
// the Cloudflare Worker under its size limit (docs/DEPLOY.md, "Known notes").

export type StepData = { step: GraphNode; problems: string[] };
export type StepNode = Node<StepData, "step">;

/** One line describing a step on its box. */
function summary(step: GraphNode): string {
  switch (step.type) {
    case "trigger":
      return `${TRIGGER_LABELS[step.data.kind]}${step.data.keywords.length ? `: ${step.data.keywords.slice(0, 3).join(", ")}` : ""} · ${step.data.channels.map((c) => CHANNEL_LABELS[c]).join(", ") || "choose a channel"}`;
    case "message":
    case "question":
      return step.data.text || "Write the text…";
    case "ai":
      return step.data.goal || "Tell the AI the goal…";
    case "condition":
      return `${step.data.rules.length} ${step.data.rules.length === 1 ? "rule" : "rules"} (${step.data.mode === "all" ? "all must match" : "any one"})`;
    case "action":
      return step.data.actions.map((a) => a.kind.replace(/_/g, " ") + (a.tag ? ` “${a.tag}”` : a.key ? ` ${a.key}` : "")).join(", ");
    case "wait":
      return step.data.minutes % 1440 === 0 ? `${step.data.minutes / 1440} day(s)` : step.data.minutes % 60 === 0 ? `${step.data.minutes / 60} hour(s)` : `${step.data.minutes} minutes`;
    case "handover":
      return step.data.note || "Hand the conversation to the team";
    case "end":
      return "The automation ends here";
  }
}

function StepBox({ data, selected }: NodeProps<StepNode>) {
  const { step, problems } = data;
  const Icon = ICONS[step.type];
  const exits = exitsOf(step);
  return (
    <div className={cn("w-[240px] rounded-2xl border bg-white text-left shadow-glass", selected ? "border-pulse-blue ring-2 ring-pulse-blue/30" : problems.length ? "border-amber-400" : "border-line")}>
      {step.type !== "trigger" && <Handle type="target" position={Position.Top} className="!size-3 !border-2 !border-white !bg-pulse-blue" />}
      <div className={cn("flex items-center gap-2 rounded-t-2xl px-3 py-2 text-[13px] font-semibold", step.type === "trigger" ? "bg-ink text-white" : "bg-soft")}>
        <Icon className="size-4" aria-hidden />
        {NODE_LABELS[step.type]}
        {problems.length > 0 && <span className="ml-auto text-amber-600" title={problems.join(" ")}>●</span>}
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap break-words px-3 py-2 text-[12px] text-text">{summary(step)}</p>
      {exits.length > 0 && (
        <div className="flex border-t border-line">
          {exits.map((e) => (
            <span key={e.handle} className="relative flex-1 truncate px-1 pb-3 pt-1 text-center text-[10px] text-muted">
              {e.label}
              <Handle id={e.handle} type="source" position={Position.Bottom} className="!size-3 !border-2 !border-white !bg-ink" />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES = { step: StepBox };

export type CanvasProps = {
  nodes: StepNode[];
  edges: Edge[];
  /** React Flow's own applyNodeChanges comes along, so the editor applies the changes without importing React Flow. */
  onNodesChange: (changes: NodeChange<StepNode>[], apply: typeof applyNodeChanges<StepNode>) => void;
  onEdgesChange: (changes: EdgeChange[], apply: typeof applyEdgeChanges<Edge>) => void;
  onConnect: (c: Connection) => void;
  onSelect: (id: string | null) => void;
};

export function AutomationCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onSelect }: CanvasProps) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={(changes: NodeChange<StepNode>[]) => onNodesChange(changes, applyNodeChanges)}
      onEdgesChange={(changes) => onEdgesChange(changes, applyEdgeChanges)}
      onConnect={onConnect}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      minZoom={0.3}
      deleteKeyCode={["Backspace", "Delete"]}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={18} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable style={{ width: 150, height: 100 }} className="!hidden md:!block" />
    </ReactFlow>
  );
}
