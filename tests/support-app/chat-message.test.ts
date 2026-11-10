import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBubble, TypingBubble } from "@/components/support-app/chat/message";
import type { ConversationDetail } from "@/lib/support/contract";

type Message = ConversationDetail["messages"][number];
const msg = (over: Partial<Message>): Message => ({
  id: "m1",
  author: "VISITOR",
  kind: "TEXT",
  body: "Hello there",
  agentName: null,
  sources: null,
  actions: null,
  attachment: null,
  createdAt: "2026-11-10T09:00:00.000Z",
  clientMsgId: null,
  seenByVisitorAt: null,
  original: null,
  ...over,
});
const html = (m: Message, live: boolean) => renderToStaticMarkup(createElement(MessageBubble, { m, live, first: true, last: true, visitorName: "Aline Uwase" }));

describe("MessageBubble", () => {
  it("animates only messages that arrived while the chat was open, each with its own entrance", () => {
    expect(html(msg({}), false)).not.toMatch(/sc-(in-left|rise|pop)/);
    expect(html(msg({}), true)).toContain("sc-in-left");
    expect(html(msg({ author: "AI" }), true)).toContain("sc-rise");
    expect(html(msg({ author: "AGENT", agentName: "Jean M." }), true)).toContain("sc-pop");
    expect(html(msg({ author: "SYSTEM", kind: "EVENT", body: "Jean joined" }), true)).toContain("sc-fade");
  });
  it("labels internal notes as team-only and AI answers as the AI", () => {
    expect(html(msg({ author: "AGENT", kind: "NOTE", agentName: "Jean M." }), false)).toContain("only the team sees this");
    expect(html(msg({ author: "AI" }), false)).toContain("AI assistant");
  });
  it("shows what the agent wrote before translation, and whether the visitor saw it", () => {
    const out = html(msg({ author: "AGENT", agentName: "Jean M.", body: "Muraho", original: "Hello", seenByVisitorAt: "2026-11-10T09:01:00.000Z" }), false);
    expect(out).toContain("see what you wrote");
    expect(out).toContain("Hello");
    expect(out).toContain("Seen by the visitor");
  });
});

describe("TypingBubble", () => {
  it("shows the visitor's sneak peek with typing dots", () => {
    const out = renderToStaticMarkup(createElement(TypingBubble, { who: "visitor", name: "Eric N.", draft: "and if I add a 4th shop" }));
    expect(out).toContain("sc-dot");
    expect(out).toContain("and if I add a 4th shop");
    expect(out).toContain("Eric N. is typing");
  });
  it("shows a shimmering line while the AI writes", () => {
    const out = renderToStaticMarkup(createElement(TypingBubble, { who: "ai", name: "Eric N.", draft: "" }));
    expect(out).toContain("sc-shimmer");
  });
});
