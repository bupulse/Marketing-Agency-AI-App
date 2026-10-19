import { describe, expect, it } from "vitest";
import { conditionHolds, fold, hasKeyword, pickAutomation, renderText, triggerScore, validateAnswer, type TriggerInput } from "@/lib/automations/match";
import { triggerDataSchema, type TriggerData } from "@/lib/automations/graph";

const trigger = (over: Partial<TriggerData>): TriggerData => triggerDataSchema.parse({ kind: "keyword", channels: ["INSTAGRAM", "WEBSITE"], ...over });
const dm = (text: string, over: Partial<TriggerInput> = {}): TriggerInput => ({ channel: "INSTAGRAM", kind: "MESSAGE", text, firstMessage: false, ...over });

describe("keywords", () => {
  it("ignores case, accents and punctuation", () => {
    expect(fold("  Prix ÉTÉ!! ")).toBe("prix ete");
    expect(hasKeyword("What is the PRICE?", "price", "contains")).toBe(true);
    expect(hasKeyword("Igiciro ni angahe?", "igiciro", "contains")).toBe(true);
  });

  it("matches whole words only, and exact means the whole message", () => {
    expect(hasKeyword("this is priceless", "price", "contains")).toBe(false);
    expect(hasKeyword("price list please", "price list", "contains")).toBe(true);
    expect(hasKeyword("price please", "price", "exact")).toBe(false);
    expect(hasKeyword("Price!", "price", "exact")).toBe(true);
  });
});

describe("which automation starts", () => {
  it("needs the channel and the right kind (comments only start comment triggers)", () => {
    expect(triggerScore(trigger({ keywords: ["price"] }), dm("price", { channel: "FACEBOOK" }))).toBe(0);
    expect(triggerScore(trigger({ keywords: ["price"] }), dm("price", { kind: "COMMENT" }))).toBe(0);
    expect(triggerScore(trigger({ kind: "comment_keyword", keywords: ["price"] }), dm("price"))).toBe(0);
    expect(triggerScore(trigger({ kind: "comment_keyword", keywords: ["price"] }), dm("PRICE", { kind: "COMMENT" }))).toBeGreaterThan(0);
  });

  it("limits comment triggers to the chosen posts", () => {
    const t = trigger({ kind: "any_comment", postIds: ["p1"] });
    expect(triggerScore(t, dm("nice", { kind: "COMMENT", postExternalId: "p2" }))).toBe(0);
    expect(triggerScore(t, dm("nice", { kind: "COMMENT", postExternalId: "p1" }))).toBeGreaterThan(triggerScore(trigger({ kind: "any_comment" }), dm("nice", { kind: "COMMENT", postExternalId: "p1" })));
  });

  it("story mentions start only story triggers", () => {
    expect(triggerScore(trigger({ kind: "story_mention", channels: ["INSTAGRAM"] }), dm("", { kind: "STORY_MENTION" }))).toBeGreaterThan(0);
    expect(triggerScore(trigger({ kind: "default_reply" }), dm("", { kind: "STORY_MENTION" }))).toBe(0);
  });

  it("first message only fires on the first message", () => {
    const t = trigger({ kind: "first_message" });
    expect(triggerScore(t, dm("hi"))).toBe(0);
    expect(triggerScore(t, dm("hi", { firstMessage: true }))).toBeGreaterThan(0);
  });

  it("the most specific wins: keyword over first message over default reply; exact and longer keywords first", () => {
    const list = [
      { id: "default", trigger: trigger({ kind: "default_reply" }) },
      { id: "welcome", trigger: trigger({ kind: "first_message" }) },
      { id: "price", trigger: trigger({ keywords: ["price"] }) },
      { id: "pricelist", trigger: trigger({ keywords: ["price list"] }) },
    ];
    expect(pickAutomation(list, dm("hello", { firstMessage: true }))!.id).toBe("welcome");
    expect(pickAutomation(list, dm("hello"))!.id).toBe("default");
    expect(pickAutomation(list, dm("the price please", { firstMessage: true }))!.id).toBe("price");
    expect(pickAutomation(list, dm("send the price list"))!.id).toBe("pricelist");
    expect(pickAutomation([], dm("hello"))).toBeNull();
  });

  it("on a tie the most recently changed automation wins", () => {
    const older = { id: "a", trigger: trigger({ keywords: ["menu"] }), updatedAt: new Date("2026-10-01") };
    const newer = { id: "b", trigger: trigger({ keywords: ["menu"] }), updatedAt: new Date("2026-10-10") };
    expect(pickAutomation([older, newer], dm("menu"))!.id).toBe("b");
    expect(pickAutomation([newer, older], dm("menu"))!.id).toBe("b");
  });
});

describe("message texts", () => {
  it("fills the variables and tidies missing ones", () => {
    expect(renderText("Hi {{first_name}}! Welcome to {{business}}.", { name: "Aline Uwase", business: "Inzu Fashion" })).toBe("Hi Aline! Welcome to Inzu Fashion.");
    expect(renderText("Hi {{first_name}}!", {})).toBe("Hi!");
    expect(renderText("Size: {{field.size}} {{unknown}}", { fields: { size: "M" } })).toBe("Size: M");
  });
});

describe("conditions", () => {
  const ctx = { tags: ["VIP", "Bought"], fields: { district: "Gasabo" }, email: null, phone: "+250788000000", channel: "INSTAGRAM" as const, lastText: "Do you deliver to Kicukiro?" };
  it("checks tags, fields, details, channel and the last message", () => {
    expect(conditionHolds([{ kind: "has_tag", value: "vip", key: "" }], "all", ctx)).toBe(true);
    expect(conditionHolds([{ kind: "no_tag", value: "bought", key: "" }], "all", ctx)).toBe(false);
    expect(conditionHolds([{ kind: "field_equals", key: "district", value: "gasabo" }], "all", ctx)).toBe(true);
    expect(conditionHolds([{ kind: "field_set", key: "size", value: "" }], "all", ctx)).toBe(false);
    expect(conditionHolds([{ kind: "has_email", key: "", value: "" }, { kind: "has_phone", key: "", value: "" }], "any", ctx)).toBe(true);
    expect(conditionHolds([{ kind: "has_email", key: "", value: "" }, { kind: "has_phone", key: "", value: "" }], "all", ctx)).toBe(false);
    expect(conditionHolds([{ kind: "channel_is", key: "", value: "INSTAGRAM" }], "all", ctx)).toBe(true);
    expect(conditionHolds([{ kind: "text_contains", key: "", value: "kicukiro" }], "all", ctx)).toBe(true);
  });
});

describe("answers to questions", () => {
  it("finds an email or phone inside a sentence and refuses junk", () => {
    expect(validateAnswer("sure it's Aline@Example.com thanks", "email")).toBe("aline@example.com");
    expect(validateAnswer("no email", "email")).toBeNull();
    expect(validateAnswer("0788 123 456", "phone")).toBe("0788123456");
    expect(validateAnswer("12", "phone")).toBeNull();
    expect(validateAnswer("about 200,000 RWF", "number")).toBe("200000");
    expect(validateAnswer("   ", "any")).toBeNull();
  });
});
