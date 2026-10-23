import { describe, expect, it } from "vitest";
import { fromAdOrBio, greetingMode, RECENT_CHAT_MS, type GreetingInput } from "@/lib/support/client/greeting";
import { chatSurface, isPhoneWidth } from "@/lib/support/client/mount";

const NOW = Date.UTC(2026, 9, 23, 10);
const base: GreetingInput = {
  greeting: { text: "Hi! Questions about BuPulse?", delaySec: 15, quickReplies: [] },
  surface: "public",
  isPhone: false,
  now: NOW,
  lastChatAt: null,
  pageIndex: 0,
  landedFromAdOrBio: false,
  chatting: false,
  panelOpen: false,
  seenThisVisit: false,
};

describe("greeting rules", () => {
  it("shows a bubble on a computer and only a dot on a phone", () => {
    expect(greetingMode(base)).toBe("bubble");
    expect(greetingMode({ ...base, isPhone: true })).toBe("dot");
  });

  it("never shows without a greeting from the server, on a bio page, or twice in a visit", () => {
    expect(greetingMode({ ...base, greeting: null })).toBeNull();
    expect(greetingMode({ ...base, surface: "bio" })).toBeNull();
    expect(greetingMode({ ...base, seenThisVisit: true })).toBeNull();
  });

  it("never shows while chatting or with the panel open", () => {
    expect(greetingMode({ ...base, chatting: true })).toBeNull();
    expect(greetingMode({ ...base, panelOpen: true })).toBeNull();
  });

  it("waits 7 days after the last chat", () => {
    expect(greetingMode({ ...base, lastChatAt: NOW - 60_000 })).toBeNull();
    expect(greetingMode({ ...base, lastChatAt: NOW - RECENT_CHAT_MS + 1000 })).toBeNull();
    expect(greetingMode({ ...base, lastChatAt: NOW - RECENT_CHAT_MS - 1000 })).toBe("bubble");
  });

  it("skips the first page of a visit from an ad or a bio link, not the next ones", () => {
    expect(greetingMode({ ...base, landedFromAdOrBio: true })).toBeNull();
    expect(greetingMode({ ...base, landedFromAdOrBio: true, pageIndex: 1 })).toBe("bubble");
  });

  it("tells ad and bio landings from the rest", () => {
    expect(fromAdOrBio("?gclid=abc", "")).toBe(true);
    expect(fromAdOrBio("?fbclid=abc", "")).toBe(true);
    expect(fromAdOrBio("?utm_source=facebook&utm_medium=cpc", "")).toBe(true);
    expect(fromAdOrBio("?utm_source=bio&utm_medium=referral", "")).toBe(true);
    expect(fromAdOrBio("", "https://bupulse.com/b/sample-salon")).toBe(true);
    expect(fromAdOrBio("?utm_source=newsletter&utm_medium=email", "https://www.google.com/")).toBe(false);
    expect(fromAdOrBio("", "")).toBe(false);
    expect(fromAdOrBio("", "not a url")).toBe(false);
  });
});

describe("where the chat mounts", () => {
  it("shows on the public site, the dashboard and the creator portal", () => {
    expect(chatSurface("/")).toBe("public");
    expect(chatSurface("/pricing")).toBe("public");
    expect(chatSurface("/creators")).toBe("public");
    expect(chatSurface("/signup")).toBe("public");
    expect(chatSurface("/dashboard")).toBe("dashboard");
    expect(chatSurface("/dashboard/connections")).toBe("dashboard");
    expect(chatSurface("/creator")).toBe("creator");
    expect(chatSurface("/creator/campaigns/1")).toBe("creator");
  });

  it("never on Admin, the support app, bio pages, the chat page, the website-chat frame or the TV screen", () => {
    for (const p of ["/admin", "/admin/live-chat", "/support", "/support/inbox", "/b/sample", "/help-chat", "/widget/k1", "/screen/t1", "/api/support/v1/visit"])
      expect(chatSurface(p), p).toBeNull();
    // A prefix only counts as a whole segment.
    expect(chatSurface("/administration")).toBe("public");
    expect(chatSurface("/blog")).toBe("public");
  });

  it("never on the support host", () => {
    expect(chatSurface("/", "support.bupulse.com")).toBeNull();
    expect(chatSurface("/inbox", "SUPPORT.bupulse.com")).toBeNull();
    expect(chatSurface("/", "bupulse.com")).toBe("public");
    expect(chatSurface("/", "test.bupulse.com")).toBe("public");
  });

  it("calls 480 px and narrower a phone", () => {
    expect(isPhoneWidth(390)).toBe(true);
    expect(isPhoneWidth(480)).toBe(true);
    expect(isPhoneWidth(481)).toBe(false);
    expect(isPhoneWidth(1280)).toBe(false);
    expect(isPhoneWidth(0)).toBe(false);
  });
});
