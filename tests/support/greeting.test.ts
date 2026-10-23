import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/support/jobs", () => ({ scheduleSweep: vi.fn() }));
vi.mock("@/lib/support/identity", () => ({ signedInPerson: vi.fn() }));
vi.mock("@/lib/support/realtime", () => ({ broadcast: vi.fn(), realtimeConnection: vi.fn() }));
vi.mock("@/lib/support/views", () => ({ conversationSelect: {}, messageSelect: {}, toConversationView: vi.fn() }));

import { DEFAULT_SUPPORT_SETTINGS, greetingFor } from "@/lib/support/settings";
import { greetingDecision } from "@/lib/support/visits";
import { GREETING_QUIET_MS } from "@/lib/support/limits";

const now = new Date("2026-10-23T09:00:00Z");
const base = { rule: greetingFor(DEFAULT_SUPPORT_SETTINGS, "/pricing"), surface: "public" as const, device: "desktop", optedOut: false, openChat: false, lastChatAt: null, now };

describe("greeting bubble", () => {
  it("shows the page's greeting with its delay and quick replies", () => {
    expect(greetingDecision(base)).toEqual({ text: "Questions about plans? Ask me anything about BuPulse.", delaySec: 30, quickReplies: ["Which plan fits me?", "How does the trial work?"] });
  });

  it("never shows on the bio corner link, on phones, when opted out or with a chat open", () => {
    expect(greetingDecision({ ...base, surface: "bio" })).toBeNull();
    expect(greetingDecision({ ...base, device: "phone" })).toBeNull();
    expect(greetingDecision({ ...base, optedOut: true })).toBeNull();
    expect(greetingDecision({ ...base, openChat: true })).toBeNull();
  });

  it("stays quiet for a week after a chat, then shows again", () => {
    expect(greetingDecision({ ...base, lastChatAt: new Date(now.getTime() - GREETING_QUIET_MS + 60_000) })).toBeNull();
    expect(greetingDecision({ ...base, lastChatAt: new Date(now.getTime() - GREETING_QUIET_MS - 60_000) })).not.toBeNull();
  });

  it("tablets and the dashboard get it; no rule means none", () => {
    expect(greetingDecision({ ...base, device: "tablet", surface: "dashboard" })).not.toBeNull();
    expect(greetingDecision({ ...base, rule: null })).toBeNull();
  });
});
