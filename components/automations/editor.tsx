"use client";

import "@xyflow/react/dist/style.css";
import type { Connection, Edge, EdgeChange, NodeChange } from "@xyflow/react";
import { ArrowLeft, Pause, Play, Smartphone } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { pause, publishAutomation, save } from "@/app/dashboard/automations/actions";
import { Badge, Button, GlassCard, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  NODE_LABELS,
  exitsOf,
  graphProblems,
  graphSchema,
  type Graph,
  type GraphNode,
  type GraphProblem,
  type NodeType,
} from "@/lib/automations/graph";
import type { CanvasProps, StepNode } from "./canvas";
import { ICONS } from "./icons";
import { StepForm, newStep } from "./step-form";
import { PhonePreview } from "./preview";

// The canvas runs in the browser only: React Flow stays out of the server bundle (canvas.tsx).
const AutomationCanvas = dynamic(() => import("./canvas").then((m) => m.AutomationCanvas), { ssr: false });

const PALETTE: NodeType[] = ["message", "question", "ai", "condition", "action", "wait", "handover", "end"];
const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "blue" }> = { LIVE: { label: "Live", tone: "success" }, PAUSED: { label: "Paused", tone: "neutral" }, DRAFT: { label: "Draft", tone: "blue" } };

/** A fresh id for a line on the canvas. */
const newEdgeId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function toFlow(graph: Graph, problems: GraphProblem[]): { nodes: StepNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: "step", position: n.position, data: { step: n, problems: problems.filter((p) => p.nodeId === n.id).map((p) => p.message) }, deletable: n.type !== "trigger" })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "next", animated: false })),
  };
}

export type EditorProps = {
  automation: { id: string; name: string; status: "DRAFT" | "LIVE" | "PAUSED"; graph: Graph; changed: boolean };
  fields: { key: string; label: string }[];
  tags: string[];
  businessName: string;
};

export function AutomationEditor({ automation, fields, tags, businessName }: EditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(automation.name);
  const [graph, setGraph] = useState<Graph>(automation.graph);
  const [selectedId, setSelectedId] = useState<string | null>("trigger");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<GraphProblem[]>([]);
  const [preview, setPreview] = useState(false);
  // The size React Flow measured for each box: kept apart from the graph, because the canvas hides boxes it has not measured.
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});

  const problems = useMemo(() => {
    const parsed = graphSchema.safeParse(graph);
    return parsed.success ? graphProblems(parsed.data) : [{ message: "Some steps have settings that are not valid." }];
  }, [graph]);
  const flow = useMemo(() => toFlow(graph, problems), [graph, problems]);
  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;

  function update(next: Graph) {
    setGraph(next);
    setDirty(true);
    setServerProblems([]);
  }

  function onNodesChange(changes: NodeChange<StepNode>[], apply: Parameters<CanvasProps["onNodesChange"]>[1]) {
    const sized = changes.filter((c) => c.type === "dimensions" && c.dimensions);
    if (sized.length) {
      setDims((cur) => {
        const next = { ...cur };
        for (const c of sized) if (c.type === "dimensions" && c.dimensions) next[c.id] = c.dimensions;
        return next;
      });
    }
    if (sized.length === changes.length) return;
    // Positions and deletions come from the canvas; the graph stays the single source of truth.
    const applied = apply(changes, flow.nodes);
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    const moved = changes.some((c) => c.type === "position" && !c.dragging) || removed.length;
    const nodes = graph.nodes
      .filter((n) => !removed.includes(n.id))
      .map((n) => {
        const f = applied.find((a) => a.id === n.id);
        return f ? { ...n, position: { x: Math.round(f.position.x), y: Math.round(f.position.y) } } : n;
      });
    const next = { nodes, edges: graph.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)) };
    if (removed.includes(selectedId ?? "")) setSelectedId(null);
    if (moved) update(next);
    else setGraph(next);
  }

  function onEdgesChange(changes: EdgeChange[], apply: Parameters<CanvasProps["onEdgesChange"]>[1]) {
    const kept = apply(changes, flow.edges).map((e) => e.id);
    if (changes.some((c) => c.type === "remove")) update({ ...graph, edges: graph.edges.filter((e) => kept.includes(e.id)) });
  }

  function onConnect(c: Connection) {
    if (!c.source || !c.target || c.source === c.target) return;
    const handle = c.sourceHandle ?? "next";
    // One line per exit: a new line from the same exit replaces the old one.
    const edges = graph.edges.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "next") === handle));
    update({ ...graph, edges: [...edges, { id: newEdgeId(), source: c.source, target: c.target, sourceHandle: handle }] });
  }

  function addStep(type: NodeType) {
    const anchor = selected ?? graph.nodes[graph.nodes.length - 1];
    const step = newStep(type, { x: (anchor?.position.x ?? 0) + 20, y: (anchor?.position.y ?? 0) + 190 });
    const edges = [...graph.edges];
    // Connect it under the selected step when that step's first exit is free.
    if (anchor) {
      const free = exitsOf(anchor).find((x) => !edges.some((e) => e.source === anchor.id && (e.sourceHandle ?? "next") === x.handle));
      if (free) edges.push({ id: newEdgeId(), source: anchor.id, target: step.id, sourceHandle: free.handle });
    }
    update({ nodes: [...graph.nodes, step], edges });
    setSelectedId(step.id);
  }

  function changeStep(step: GraphNode) {
    // Buttons removed from a message lose their lines.
    const exits = new Set(exitsOf(step).map((e) => e.handle));
    update({ nodes: graph.nodes.map((n) => (n.id === step.id ? step : n)), edges: graph.edges.filter((e) => e.source !== step.id || exits.has(e.sourceHandle ?? "next")) });
  }

  function deleteStep(id: string) {
    update({ nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.source !== id && e.target !== id) });
    setSelectedId(null);
  }

  async function onSave(): Promise<boolean> {
    setBusy(true);
    const r = await save(automation.id, name, graph);
    setBusy(false);
    if (!r.ok) {
      toast(r.error, "error");
      return false;
    }
    setDirty(false);
    return true;
  }

  async function onPublish() {
    if (!(await onSave())) return;
    setBusy(true);
    const r = await publishAutomation(automation.id);
    setBusy(false);
    if (!r.ok) {
      setServerProblems(r.problems ?? []);
      return toast(r.error, "error");
    }
    toast(automation.status === "LIVE" ? "Changes published. New conversations use them now." : "Published. It answers from now on.", "success");
    router.refresh();
  }

  async function onPause(paused: boolean) {
    setBusy(true);
    const r = await pause(automation.id, paused);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(paused ? "Paused. It no longer answers." : "Live again.", "success");
    router.refresh();
  }

  // Live with nothing new to publish.
  const upToDate = automation.status === "LIVE" && !dirty && !automation.changed;
  const allProblems = [...problems, ...serverProblems.filter((s) => !problems.some((p) => p.message === s.message))];

  return (
    <div className="flex flex-col gap-3">
      <GlassCard padding="sm" className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard/automations" aria-label="Back to automations" className="flex size-9 items-center justify-center rounded-full hover:bg-soft">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <Input value={name} onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }} maxLength={80} aria-label="Automation name" className="max-w-xs font-semibold" />
        <Badge tone={STATUS[automation.status].tone}>{STATUS[automation.status].label}</Badge>
        {(dirty || automation.changed) && automation.status !== "DRAFT" && <Badge tone="violet">Unpublished changes</Badge>}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)}>
            <Smartphone className="size-4" aria-hidden /> {preview ? "Hide preview" : "Preview"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => onSave().then((ok) => ok && toast("Draft saved.", "success"))}>
            Save draft
          </Button>
          {automation.status === "LIVE" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onPause(true)}>
              <Pause className="size-4" aria-hidden /> Pause
            </Button>
          )}
          {automation.status === "PAUSED" && !dirty && !automation.changed ? (
            <Button size="sm" disabled={busy} onClick={() => onPause(false)}>
              <Play className="size-4" aria-hidden /> Resume
            </Button>
          ) : (
            <Button size="sm" disabled={busy || allProblems.length > 0 || upToDate} onClick={onPublish} title={allProblems.length ? "Fix the points listed first" : undefined}>
              {automation.status === "DRAFT" ? "Publish" : upToDate ? "Published" : "Publish changes"}
            </Button>
          )}
        </span>
      </GlassCard>

      {allProblems.length > 0 && (
        <GlassCard padding="sm" role="status" className="border border-amber-300 text-[13px]">
          <p className="font-semibold">Before you can publish:</p>
          <ul className="mt-1 list-disc pl-5">
            {allProblems.slice(0, 6).map((p, i) => (
              <li key={i}>
                {p.nodeId ? (
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setSelectedId(p.nodeId!)}>
                    {p.message}
                  </button>
                ) : (
                  p.message
                )}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <div className={cn("grid gap-3", preview ? "xl:grid-cols-[1fr_340px_320px] lg:grid-cols-[1fr_340px]" : "lg:grid-cols-[1fr_340px]")}>
        <GlassCard padding="none" className="relative h-[70vh] min-h-[480px] overflow-hidden">
          <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap gap-1.5">
            {PALETTE.map((t) => {
              const Icon = ICONS[t];
              return (
                <button key={t} type="button" onClick={() => addStep(t)} className="glass-strong inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium hover:-translate-y-0.5">
                  <Icon className="size-3.5" aria-hidden /> {NODE_LABELS[t]}
                </button>
              );
            })}
          </div>
          <AutomationCanvas
            nodes={flow.nodes.map((n) => ({ ...n, selected: n.id === selectedId, measured: dims[n.id] }))}
            edges={flow.edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelect={setSelectedId}
          />
        </GlassCard>

        <GlassCard padding="sm" className="flex max-h-[70vh] min-h-[480px] flex-col gap-3 overflow-y-auto">
          {selected ? (
            <StepForm key={selected.id} step={selected} fields={fields} tags={tags} onChange={changeStep} onDelete={selected.type === "trigger" ? undefined : () => deleteStep(selected.id)} />
          ) : (
            <div className="flex flex-col gap-2 text-[14px] text-muted">
              <p className="font-semibold text-text">How it works</p>
              <p>Click a step to change it. Add steps with the buttons on the canvas: a new step joins under the one you selected.</p>
              <p>Drag from a dot at the bottom of a step to the top of another to join them. Each answer or button has its own dot.</p>
              <p>Select a line or a step and press Delete to remove it.</p>
            </div>
          )}
        </GlassCard>

        {preview && <PhonePreview graph={graph} businessName={businessName} />}
      </div>
    </div>
  );
}
