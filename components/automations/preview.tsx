"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { exitsOf, nextNodeId, triggerOf, type Graph, type GraphNode } from "@/lib/automations/graph";
import { buttonFor, renderText, validateAnswer } from "@/lib/automations/match";

// A phone-shaped preview that walks the draft in the browser: messages, buttons, questions and their checks, waits and
// hand-overs. Nothing is sent and no AI is called (the AI step shows a placeholder); conditions let the owner pick a
// path. It uses the same text and answer rules as the engine (lib/automations/match.ts).

type Bubble = { from: "them" | "you" | "note"; text: string };
type Waiting = { nodeId: string; kind: "button" | "reply" | "condition"; buttons?: { id: string; title: string }[] };

const SAMPLE = { name: "Aline Uwase", phone: "0788 123 456", email: "aline@example.com", fields: {} };

function walk(graph: Graph, from: string | null, businessName: string, out: Bubble[]): Waiting | null {
  let at = from;
  for (let i = 0; i < 25 && at; i++) {
    const node: GraphNode | undefined = graph.nodes.find((n) => n.id === at);
    if (!node) return null;
    const vars = { ...SAMPLE, business: businessName };
    switch (node.type) {
      case "trigger":
        at = nextNodeId(graph, node.id);
        break;
      case "message": {
        out.push({ from: "you", text: renderText(node.data.text, vars) || "(empty message)" });
        const taps = exitsOf(node).filter((e) => e.handle !== "next" && nextNodeId(graph, node.id, e.handle));
        if (taps.length) return { nodeId: node.id, kind: "button", buttons: node.data.buttons.filter((b) => !b.url).map((b) => ({ id: b.id, title: b.title || "Button" })) };
        at = nextNodeId(graph, node.id);
        break;
      }
      case "question":
        out.push({ from: "you", text: renderText(node.data.text, vars) || "(empty question)" });
        return { nodeId: node.id, kind: "reply" };
      case "ai":
        out.push({ from: "you", text: `✨ The AI answers from your knowledge base, aiming to: ${node.data.goal || "(no goal yet)"}` });
        at = nextNodeId(graph, node.id, "done");
        break;
      case "condition":
        return { nodeId: node.id, kind: "condition" };
      case "action":
        out.push({ from: "note", text: `Actions: ${node.data.actions.map((a) => a.kind.replace(/_/g, " ") + (a.tag ? ` “${a.tag}”` : "")).join(", ")}` });
        at = nextNodeId(graph, node.id);
        break;
      case "wait":
        out.push({ from: "note", text: `⏳ Waits ${node.data.minutes >= 1440 ? `${Math.round(node.data.minutes / 1440)} day(s)` : node.data.minutes >= 60 ? `${Math.round(node.data.minutes / 60)} hour(s)` : `${node.data.minutes} min`}` });
        at = nextNodeId(graph, node.id);
        break;
      case "handover":
        if (node.data.text) out.push({ from: "you", text: node.data.text });
        out.push({ from: "note", text: "Handed to your team. Automations stay quiet." });
        return null;
      case "end":
        out.push({ from: "note", text: "End." });
        return null;
    }
  }
  return null;
}

function start(graph: Graph, businessName: string): { bubbles: Bubble[]; waiting: Waiting | null } {
  const trigger = triggerOf(graph);
  if (!trigger) return { bubbles: [{ from: "note", text: "Add a trigger first." }], waiting: null };
  const t = trigger.data;
  const opener = t.kind === "keyword" || t.kind === "comment_keyword" ? t.keywords[0] || "hello" : t.kind === "story_mention" ? "(mentions you in a Story)" : "Hello!";
  const bubbles: Bubble[] = [{ from: "them", text: t.kind.includes("comment") ? `💬 Comment: ${opener}` : opener }];
  if (t.publicReplies.length && t.kind.includes("comment")) bubbles.push({ from: "note", text: `Public reply: ${t.publicReplies[0]}` });
  const waiting = walk(graph, nextNodeId(graph, trigger.id), businessName, bubbles);
  return { bubbles, waiting };
}

export function PhonePreview({ graph, businessName }: { graph: Graph; businessName: string }) {
  const [state, setState] = useState(() => start(graph, businessName));
  const [answer, setAnswer] = useState("");
  const [shownFor, setShownFor] = useState(graph);
  if (shownFor !== graph) {
    // The draft changed: start again from the trigger.
    setShownFor(graph);
    setState(start(graph, businessName));
  }

  function go(next: string | null, extra: Bubble[]) {
    const bubbles = [...state.bubbles, ...extra];
    const waiting = walk(graph, next, businessName, bubbles);
    setState({ bubbles, waiting });
  }

  function reply(text: string, buttonId?: string) {
    const w = state.waiting;
    if (!w) return;
    const mine: Bubble = { from: "them", text };
    if (w.kind === "button") {
      const chosen = buttonFor({ text, buttonId }, w.buttons ?? []);
      return go(chosen ? nextNodeId(graph, w.nodeId, chosen) : nextNodeId(graph, w.nodeId), [mine]);
    }
    if (w.kind === "reply") {
      const node = graph.nodes.find((n) => n.id === w.nodeId);
      if (node?.type === "question" && validateAnswer(text, node.data.validate) === null) {
        setState({ ...state, bubbles: [...state.bubbles, mine, { from: "you", text: node.data.retryText || "Sorry, I did not get that. Could you try again?" }] });
        return;
      }
      return go(nextNodeId(graph, w.nodeId, "answered"), [mine]);
    }
  }

  return (
    <GlassCard padding="sm" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Preview</h2>
        <Button size="sm" variant="outline" onClick={() => setState(start(graph, businessName))}>
          <RotateCcw className="size-4" aria-hidden /> Restart
        </Button>
      </div>
      <p className="text-[12px] text-muted">A practice run with a sample contact. Nothing is sent.</p>
      <div className="mx-auto flex h-[520px] w-full max-w-[290px] flex-col overflow-hidden rounded-[28px] border-[6px] border-ink bg-soft">
        <div className="bg-ink px-3 py-2 text-center text-[12px] font-semibold text-white">{businessName}</div>
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2" aria-live="polite">
          {state.bubbles.map((b, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px]",
                b.from === "them" ? "self-end bg-pulse-blue text-white" : b.from === "you" ? "self-start bg-white shadow-glass" : "self-center bg-transparent text-center text-[11px] text-muted",
              )}
            >
              {b.text}
            </div>
          ))}
          {state.waiting?.kind === "button" && (
            <div className="flex flex-wrap gap-1 self-start">
              {(state.waiting.buttons ?? []).map((b) => (
                <button key={b.id} type="button" onClick={() => reply(b.title, b.id)} className="rounded-full border border-pulse-blue bg-white px-3 py-1 text-[12px] font-medium">
                  {b.title}
                </button>
              ))}
            </div>
          )}
          {state.waiting?.kind === "condition" && (
            <div className="flex flex-col gap-1 self-center text-center text-[11px] text-muted">
              Condition: which path?
              <span className="flex gap-1">
                <button type="button" className="rounded-full bg-white px-3 py-1 text-[12px] text-text" onClick={() => go(nextNodeId(graph, state.waiting!.nodeId, "yes"), [{ from: "note", text: "Condition: yes" }])}>
                  Yes
                </button>
                <button type="button" className="rounded-full bg-white px-3 py-1 text-[12px] text-text" onClick={() => go(nextNodeId(graph, state.waiting!.nodeId, "no"), [{ from: "note", text: "Condition: no" }])}>
                  No
                </button>
              </span>
            </div>
          )}
        </div>
        <form
          className="flex gap-1 border-t border-line bg-white p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!answer.trim()) return;
            reply(answer.trim());
            setAnswer("");
          }}
        >
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!state.waiting || state.waiting.kind === "condition"} placeholder={state.waiting ? "Type an answer" : "Finished"} aria-label="Answer in the preview" className="min-w-0 flex-1 rounded-full bg-soft px-3 text-[13px] outline-none" />
          <button type="submit" disabled={!state.waiting} className="rounded-full bg-ink px-3 text-[12px] font-semibold text-white disabled:opacity-40">
            Send
          </button>
        </form>
      </div>
    </GlassCard>
  );
}
