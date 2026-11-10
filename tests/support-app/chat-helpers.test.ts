import { describe, expect, it } from "vitest";
import { avatarTone, countryName, diffList, flagEmoji, messageRuns, placeLabel } from "@/components/support-app/chat/helpers";

describe("flagEmoji", () => {
  it("turns a two-letter country code into its flag", () => {
    expect(flagEmoji("RW")).toBe("🇷🇼");
    expect(flagEmoji("ug")).toBe("🇺🇬");
  });
  it("gives a globe for anything else", () => {
    expect(flagEmoji(null)).toBe("🌍");
    expect(flagEmoji("")).toBe("🌍");
    expect(flagEmoji("Rwanda")).toBe("🌍");
  });
});

describe("countryName and placeLabel", () => {
  it("names a country from its code and keeps full names", () => {
    expect(countryName("RW")).toBe("Rwanda");
    expect(countryName("Rwanda")).toBe("Rwanda");
    expect(countryName(null)).toBeNull();
  });
  it("joins the city and the country", () => {
    expect(placeLabel("Kigali", "RW")).toBe("Kigali, Rwanda");
    expect(placeLabel(null, "UG")).toBe("Uganda");
    expect(placeLabel(null, null)).toBeNull();
  });
});

describe("messageRuns", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 10, 9, min)).toISOString();
  it("groups messages from the same author a few minutes apart", () => {
    const runs = messageRuns([
      { author: "VISITOR", kind: "TEXT", createdAt: at(0) },
      { author: "VISITOR", kind: "FILE", createdAt: at(1) },
      { author: "AI", kind: "TEXT", createdAt: at(2) },
      { author: "AGENT", kind: "NOTE", createdAt: at(3) },
      { author: "AGENT", kind: "TEXT", createdAt: at(4) },
      { author: "AGENT", kind: "TEXT", createdAt: at(20) },
    ]);
    expect(runs).toEqual([
      { first: true, last: false },
      { first: false, last: true },
      { first: true, last: true },
      { first: true, last: true }, // a note never joins a reply
      { first: true, last: true }, // 16 minutes later starts a new run
      { first: true, last: true },
    ]);
  });
  it("never groups system events", () => {
    const runs = messageRuns([
      { author: "SYSTEM", kind: "EVENT", createdAt: at(0) },
      { author: "SYSTEM", kind: "EVENT", createdAt: at(0) },
    ]);
    expect(runs).toEqual([
      { first: true, last: true },
      { first: true, last: true },
    ]);
  });
});

describe("diffList", () => {
  it("marks nothing on the first load", () => {
    const d = diffList(null, [{ id: "a", lastMessageAt: "1" }]);
    expect([...d.fresh]).toEqual([]);
    expect([...d.bumped]).toEqual([]);
    expect(d.memory.get("a")).toBe("1");
  });
  it("finds new chats and chats with a newer message", () => {
    const first = diffList(null, [
      { id: "a", lastMessageAt: "1" },
      { id: "b", lastMessageAt: "1" },
    ]);
    const next = diffList(first.memory, [
      { id: "a", lastMessageAt: "1" },
      { id: "b", lastMessageAt: "2" },
      { id: "c", lastMessageAt: "2" },
    ]);
    expect([...next.fresh]).toEqual(["c"]);
    expect([...next.bumped]).toEqual(["b"]);
  });
});

describe("avatarTone", () => {
  it("gives the same person the same colour", () => {
    expect(avatarTone("Aline Uwase")).toBe(avatarTone("Aline Uwase"));
    expect(typeof avatarTone("")).toBe("string");
  });
});
