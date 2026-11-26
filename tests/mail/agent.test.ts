import { describe, expect, it } from "vitest";
import { agentSendsLeft, AGENT_KEY_PREFIX, bearerAgentKey, decodeCursor, encodeCursor, generateAgentKey, parseDailyLimit, parseLimit, parseSendInput } from "@/lib/mail/agent-rules";

// The B Mail agent API's pure rules (docs/mail-crm/AGENT_API.md).

describe("agent keys", () => {
  it("makes long random keys with a short prefix", () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    expect(a.key.startsWith(AGENT_KEY_PREFIX)).toBe(true);
    expect(a.key).not.toBe(b.key);
    expect(a.key.length).toBeGreaterThan(50);
    expect(a.key).toMatch(/^bpm_live_[A-Za-z0-9_-]+$/);
    expect(a.prefix).toBe(a.key.slice(0, AGENT_KEY_PREFIX.length + 4));
  });

  it("reads only a bearer agent key", () => {
    const { key } = generateAgentKey();
    expect(bearerAgentKey(`Bearer ${key}`)).toBe(key);
    expect(bearerAgentKey(`bearer ${key}`)).toBe(key);
    expect(bearerAgentKey(null)).toBeNull();
    expect(bearerAgentKey("Bearer bp_live_abc")).toBeNull();
    expect(bearerAgentKey(`Basic ${key}`)).toBeNull();
    expect(bearerAgentKey(`Bearer ${key}${"x".repeat(200)}`)).toBeNull();
  });
});

describe("inbox cursor", () => {
  it("round-trips and refuses anything else", () => {
    const c = { at: new Date("2026-11-26T08:00:00.123Z"), id: "cmabc1234567890" };
    const back = decodeCursor(encodeCursor(c));
    expect(back).toEqual(c);
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not base64!")).toBe("invalid");
    expect(decodeCursor(Buffer.from("yesterday|cmabc1234567890").toString("base64url"))).toBe("invalid");
    expect(decodeCursor(Buffer.from("2026-11-26T08:00:00Z|x';--").toString("base64url"))).toBe("invalid");
    expect(decodeCursor(Buffer.from("2026-11-26T08:00:00Z|cmabc1234567890|extra").toString("base64url"))).toBe("invalid");
  });

  it("limits a page to 1..100", () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("100")).toBe(100);
    expect(parseLimit("0")).toBeNull();
    expect(parseLimit("101")).toBeNull();
    expect(parseLimit("2.5")).toBeNull();
  });
});

describe("send input", () => {
  it("takes one recipient, a subject, text and an optional Message-ID", () => {
    const r = parseSendInput({ to: "Ana@Example.com", subject: " Quick question ", text: "Hi Ana,\r\nShort note.", inReplyTo: "<abc@mail.example.com>" });
    expect(r).toEqual({ ok: true, input: { to: { name: "", address: "ana@example.com" }, subject: "Quick question", text: "Hi Ana,\nShort note.", inReplyTo: "abc@mail.example.com" } });
    const named = parseSendInput({ to: { name: "Ana <B>\r\nBcc: x", address: "ana@example.com" }, subject: "s", text: "t" });
    expect(named.ok && named.input.to).toEqual({ name: "Ana B Bcc: x", address: "ana@example.com" });
  });

  it("refuses what it cannot send safely", () => {
    expect(parseSendInput(null).ok).toBe(false);
    expect(parseSendInput([]).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com, b@example.com", subject: "s", text: "t" }).ok).toBe(false);
    expect(parseSendInput({ to: ["a@example.com"], subject: "s", text: "t" }).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com", subject: "", text: "t" }).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com", subject: "s\r\nBcc: x@example.com", text: "t" }).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com", subject: "s", text: " " }).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com", subject: "s".repeat(301), text: "t" }).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com", subject: "s", text: "t".repeat(50_001) }).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com", subject: "s", text: "t", inReplyTo: "not an id" }).ok).toBe(false);
    expect(parseSendInput({ to: "a@example.com", subject: "s", text: "t", inReplyTo: 5 }).ok).toBe(false);
  });
});

describe("daily sends", () => {
  it("stops at the key's own limit and never passes what the team has left", () => {
    expect(agentSendsLeft({ dailyLimit: 50, keySentToday: 0, teamLeft: 100 })).toBe(50);
    expect(agentSendsLeft({ dailyLimit: 50, keySentToday: 49, teamLeft: 100 })).toBe(1);
    expect(agentSendsLeft({ dailyLimit: 50, keySentToday: 50, teamLeft: 100 })).toBe(0);
    expect(agentSendsLeft({ dailyLimit: 50, keySentToday: 10, teamLeft: 3 })).toBe(3);
    expect(agentSendsLeft({ dailyLimit: 50, keySentToday: 60, teamLeft: 3 })).toBe(0);
  });

  it("takes a console limit from 1 to 100", () => {
    expect(parseDailyLimit("50")).toBe(50);
    expect(parseDailyLimit(1)).toBe(1);
    expect(parseDailyLimit("0")).toBeNull();
    expect(parseDailyLimit("101")).toBeNull();
    expect(parseDailyLimit("ten")).toBeNull();
    expect(parseDailyLimit(null)).toBeNull();
  });
});
