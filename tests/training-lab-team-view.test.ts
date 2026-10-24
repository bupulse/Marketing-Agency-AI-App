import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AGENTS, agentById, type AgentId } from "@/lib/training-lab/agents";
import { AGENT_ICONS, Pipeline } from "@/app/admin/(console)/(ai)/training-lab/team/pipeline";
import { POST_PIPELINE, REEL_PIPELINE, SHORT_BRAIN, costChip, learnsLine, pipelineCovers } from "@/app/admin/(console)/(ai)/training-lab/team/view";

const card = (id: AgentId, over: Record<string, unknown> = {}) => ({ agent: agentById(id)!, examples: 3, using: agentById(id)!.defaultBrain, defaultNote: null as string | null, ...over });

describe("the pipelines", () => {
  it("put every member in a pipeline once, reels first", () => {
    expect(REEL_PIPELINE).toEqual(["researcher", "director", "script-writer", "painter", "filmmaker", "editor", "checker"]);
    expect(POST_PIPELINE).toEqual(["designer", "caption-writer", "scheduler"]);
    expect(pipelineCovers()).toBe(true);
  });
  it("give every member an icon", () => {
    for (const a of AGENTS) expect(AGENT_ICONS[a.id]).toBeTruthy();
  });
  it("show each step with its name, linked to its card", () => {
    const html = renderToStaticMarkup(createElement(Pipeline));
    for (const id of [...REEL_PIPELINE, ...POST_PIPELINE]) {
      expect(html).toContain(`href="#agent-${id}"`);
      expect(html).toContain(agentById(id)!.name);
    }
    expect(html).toContain("A reel is made by");
    expect(html).toContain("A post adds");
  });
});

describe("the brain chips", () => {
  it("name the four brains shortly", () => {
    expect(SHORT_BRAIN).toEqual({ gemini: "Gemini", anthropic: "Claude key", "claude-subscription": "Your subscription", rules: "Rules" });
  });
  it("say Paid for a brain that costs per call and Free for rules or the subscription", () => {
    expect(costChip(card("script-writer", { using: "anthropic" }))).toBe("Paid");
    expect(costChip(card("script-writer", { using: "gemini" }))).toBe("Paid");
    expect(costChip(card("script-writer", { using: "claude-subscription" }))).toBe("Free");
    expect(costChip(card("script-writer", { using: "rules" }))).toBe("Free");
    expect(costChip(card("scheduler"))).toBe("Free");
    expect(costChip(card("painter"))).toBe("Paid");
  });
  it("follow the member when it works as it always has, or has no brain", () => {
    expect(costChip(card("script-writer", { using: "rules", defaultNote: "English on Claude, Kinyarwanda on Gemini" }))).toBe("Paid");
    expect(costChip(card("researcher", { using: null }))).toBe("Free");
    expect(costChip(card("filmmaker", { using: null }))).toBe("Paid");
  });
});

describe("the learns-from line", () => {
  it("counts the examples", () => {
    expect(learnsLine(card("director", { examples: 3 }))).toBe("Learns from 3 examples");
    expect(learnsLine(card("director", { examples: 1 }))).toBe("Learns from 1 example");
    expect(learnsLine(card("director", { examples: 0 }))).toBe("Learns from 0 examples");
  });
  it("says why a member learns from none", () => {
    expect(learnsLine(card("researcher"))).toBe("Works from the business's own facts");
    expect(learnsLine(card("filmmaker"))).toBe("Works from the business's own facts");
  });
});
