import { describe, expect, it } from "vitest";
import { emptyGraph, exitsOf, graphProblems, graphSchema, nextNodeId, readGraph, type Graph } from "@/lib/automations/graph";
import { messageForChannel, buttonFor } from "@/lib/automations/match";

const base = (): Graph =>
  graphSchema.parse({
    nodes: [
      { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "keyword", channels: ["WEBSITE"], keywords: ["menu"] } },
      { id: "m", type: "message", position: { x: 0, y: 100 }, data: { text: "Here is our menu", buttons: [{ id: "b1", title: "Order" }, { id: "b2", title: "Site", url: "https://example.com" }] } },
      { id: "q", type: "question", position: { x: 0, y: 200 }, data: { text: "Your phone?", saveTo: "phone", validate: "phone", timeoutMinutes: 30 } },
      { id: "e", type: "end", position: { x: 0, y: 300 }, data: {} },
    ],
    edges: [
      { id: "1", source: "t", target: "m" },
      { id: "2", source: "m", sourceHandle: "b1", target: "q" },
      { id: "3", source: "q", sourceHandle: "answered", target: "e" },
    ],
  });

describe("graph", () => {
  it("lists the exits of each step (link buttons are not exits)", () => {
    const g = base();
    expect(exitsOf(g.nodes[1]).map((e) => e.handle)).toEqual(["next", "b1"]);
    expect(exitsOf(g.nodes[2]).map((e) => e.handle)).toEqual(["answered", "no_answer"]);
    expect(exitsOf(g.nodes[3])).toEqual([]);
  });

  it("follows exits", () => {
    const g = base();
    expect(nextNodeId(g, "t")).toBe("m");
    expect(nextNodeId(g, "m", "b1")).toBe("q");
    expect(nextNodeId(g, "m")).toBeNull();
  });

  it("a complete graph has no problems", () => {
    expect(graphProblems(base())).toEqual([]);
  });

  it("explains what stops publishing, in plain words", () => {
    const g = base();
    g.nodes[0] = { ...g.nodes[0], data: { ...(g.nodes[0].data as object), keywords: [], channels: [] } } as unknown as Graph["nodes"][number];
    g.nodes.push({ id: "lost", type: "end", position: { x: 9, y: 9 }, data: {} });
    const messages = graphProblems(g).map((p) => p.message);
    expect(messages).toContain("Add at least one keyword.");
    expect(messages).toContain("Choose at least one channel for the trigger.");
    expect(messages).toContain("This step is not connected to the trigger.");
  });

  it("refuses comment triggers on channels without comments", () => {
    const g = base();
    g.nodes[0] = { ...g.nodes[0], data: { ...(g.nodes[0].data as object), kind: "comment_keyword" } } as unknown as Graph["nodes"][number];
    expect(graphProblems(g).map((p) => p.message)).toContain("Comment triggers work on Instagram and Facebook only.");
  });

  it("reads stored graphs safely", () => {
    expect(readGraph({ nodes: "x" })).toBeNull();
    expect(readGraph(emptyGraph())?.nodes[0].type).toBe("trigger");
  });
});

describe("buttons on any channel", () => {
  const buttons = [{ id: "b1", title: "Price" }, { id: "b2", title: "Location" }, { id: "b3", title: "Site", url: "https://x.rw" }];
  it("numbers the choices for channels without buttons", () => {
    expect(messageForChannel("Choose:", buttons, false).text).toBe("Choose:\n\n1. Price\n2. Location\nSite: https://x.rw");
    expect(messageForChannel("Choose:", buttons, true).buttons).toHaveLength(3);
  });
  it("understands a tap, the title typed or its number", () => {
    const tap = buttons.slice(0, 2);
    expect(buttonFor({ text: "", buttonId: "b2" }, tap)).toBe("b2");
    expect(buttonFor({ text: "location" }, tap)).toBe("b2");
    expect(buttonFor({ text: "1." }, tap)).toBe("b1");
    expect(buttonFor({ text: "something else" }, tap)).toBeNull();
  });
});
