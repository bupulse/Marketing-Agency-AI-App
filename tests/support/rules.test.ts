import { describe, expect, it } from "vitest";
import { askedForHuman, decideHandover, leadScore, matchedTopic, mergeTags, priorityOf, soundsUpset, urgencyOf, type AiVerdict, type LeadInput } from "@/lib/support/rules";

const topics = ["refunds", "payment confirmation", "account deletion"];
const ai = (v: Partial<AiVerdict> = {}): AiVerdict => ({ handover: "none", confident: true, sales: false, ...v });

describe("asking for a person", () => {
  it("understands English", () => {
    for (const t of ["Can I talk to a person?", "I want a real person", "human", "Agent please!", "let me speak with someone", "Please call me"]) expect(askedForHuman(t), t).toBe(true);
  });
  it("understands French, Kinyarwanda and Swahili", () => {
    for (const t of ["Je veux parler à quelqu'un", "Je voudrais un humain", "Ndashaka kuvugana n'umuntu", "Ndashaka umuntu nyawe", "Nataka kuongea na mtu", "Naomba mtu halisi"]) expect(askedForHuman(t), t).toBe(true);
  });
  it("is not fooled by the same words in other sentences", () => {
    for (const t of ["I am a sales agent", "humane", "How do I add a team member?", "Is the AI human-like?", "What does an agent cost per month in the plan?"]) expect(askedForHuman(t), t).toBe(false);
  });
});

describe("sounding upset", () => {
  it("catches anger words in several languages", () => {
    for (const t of ["This is a scam", "Your app is useless", "C'est une arnaque", "Huu ni upuuzi"]) expect(soundsUpset(t), t).toBe(true);
  });
  it("catches !!! and long shouting", () => {
    expect(soundsUpset("Why is it not working!!!")).toBe(true);
    expect(soundsUpset("WHY IS MY POST NOT WORKING TODAY")).toBe(true);
  });
  it("leaves calm messages alone", () => {
    for (const t of ["Thanks!", "OK THANKS", "My post failed, what should I do?", "Is it terribly hard to connect Instagram?"]) expect(soundsUpset(t), t).toBe(false);
  });
});

describe("always-handed-over topics", () => {
  it("matches singular and plural forms", () => {
    expect(matchedTopic("I want a refund", topics)).toBe("refunds");
    expect(matchedTopic("Refunds please", topics)).toBe("refunds");
  });
  it("needs every word of a topic", () => {
    expect(matchedTopic("Can you confirm my payment?", topics)).toBe("payment confirmation");
    expect(matchedTopic("Which payment methods do you take?", topics)).toBeNull();
  });
  it("ignores accents and case", () => {
    expect(matchedTopic("ACCOUNT DÉLETION now", topics)).toBe("account deletion");
  });
  it("returns null with no topics", () => {
    expect(matchedTopic("refund", [])).toBeNull();
  });
});

describe("hand-over decision", () => {
  const base = { surface: "dashboard" as const, topics };

  it("stays with a confident AI", () => {
    expect(decideHandover({ ...base, text: "How do I connect Instagram?", ai: ai() })).toEqual({ reason: null, salesTag: false });
  });
  it("hands over when there is no AI answer", () => {
    expect(decideHandover({ ...base, text: "Hello", ai: null })).toEqual({ reason: "not_confident", salesTag: false });
  });
  it("hands over when the AI is not sure", () => {
    expect(decideHandover({ ...base, text: "Can you do X?", ai: ai({ confident: false }) }).reason).toBe("not_confident");
  });
  it("checks in order: asked, upset, topic, not confident", () => {
    expect(decideHandover({ ...base, text: "This is a scam, I want a real person", ai: ai({ confident: false }) }).reason).toBe("asked");
    expect(decideHandover({ ...base, text: "This is a scam, give me a refund", ai: ai({ confident: false }) }).reason).toBe("upset");
    expect(decideHandover({ ...base, text: "I want a refund", ai: ai({ confident: false }) }).reason).toBe("topic");
  });
  it("follows the AI's own flags", () => {
    expect(decideHandover({ ...base, text: "hmm", ai: ai({ handover: "asked" }) }).reason).toBe("asked");
    expect(decideHandover({ ...base, text: "hmm", ai: ai({ handover: "upset" }) }).reason).toBe("upset");
    expect(decideHandover({ ...base, text: "hmm", ai: ai({ handover: "topic" }) }).reason).toBe("topic");
  });
  it("keeps sales questions on public pages with the AI, tagged, even when it is not sure", () => {
    expect(decideHandover({ surface: "public", topics, text: "Do you give discounts for NGOs?", ai: ai({ sales: true, confident: false }) })).toEqual({ reason: null, salesTag: true });
    expect(decideHandover({ surface: "bio", topics, text: "Can you make a page like this?", ai: ai({ sales: true, confident: false }) })).toEqual({ reason: null, salesTag: true });
    // A topic question that is also a sales question stays with the AI there too.
    expect(decideHandover({ surface: "public", topics, text: "Do you do refunds on the yearly plan?", ai: ai({ sales: true, handover: "topic" }) })).toEqual({ reason: null, salesTag: true });
  });
  it("still hands sales questions over in the dashboard", () => {
    expect(decideHandover({ ...base, text: "Do you give discounts?", ai: ai({ sales: true, confident: false }) })).toEqual({ reason: "not_confident", salesTag: false });
  });
  it("hands over on public pages when asked or upset, and keeps the sales tag", () => {
    expect(decideHandover({ surface: "public", topics, text: "Can I talk to a person about prices?", ai: ai({ sales: true }) })).toEqual({ reason: "asked", salesTag: true });
    expect(decideHandover({ surface: "public", topics, text: "Your prices are a rip off!!!", ai: ai({ sales: true }) })).toEqual({ reason: "upset", salesTag: true });
  });
  it("hands over a public question with no AI answer", () => {
    expect(decideHandover({ surface: "public", topics, text: "Prices?", ai: null }).reason).toBe("not_confident");
  });
});

describe("lead score", () => {
  const lead = (v: Partial<LeadInput> = {}): LeadInput => ({ surface: "public", planStatus: null, hasEmail: false, hasPhone: false, hasBusiness: false, visitorMessages: 0, sales: false, signal: "none", ...v });

  it("starts by who the person is", () => {
    expect(leadScore(lead())).toBe(20);
    expect(leadScore(lead({ surface: "creator" }))).toBe(5);
    expect(leadScore(lead({ surface: "dashboard", planStatus: "trial" }))).toBe(30);
    expect(leadScore(lead({ surface: "dashboard", planStatus: "pending_demo" }))).toBe(30);
    expect(leadScore(lead({ surface: "dashboard", planStatus: "active" }))).toBe(10);
  });
  it("grows with details, messages (up to 5), sales questions and buying signals", () => {
    expect(leadScore(lead({ hasEmail: true, hasPhone: true, hasBusiness: true }))).toBe(55);
    expect(leadScore(lead({ visitorMessages: 3 }))).toBe(29);
    expect(leadScore(lead({ visitorMessages: 50 }))).toBe(35);
    expect(leadScore(lead({ sales: true, signal: "warm" }))).toBe(50);
    expect(leadScore(lead({ signal: "hot" }))).toBeGreaterThan(leadScore(lead({ signal: "warm" })));
  });
  it("never goes over 100", () => {
    expect(leadScore(lead({ hasEmail: true, hasPhone: true, hasBusiness: true, visitorMessages: 9, sales: true, signal: "hot" }))).toBe(100);
  });
});

describe("urgency, tags and priority", () => {
  it("urgency: upset wins over urgent", () => {
    expect(urgencyOf(true, "none")).toBe("upset");
    expect(urgencyOf(false, "upset")).toBe("upset");
    expect(urgencyOf(true, "urgent")).toBe("upset");
    expect(urgencyOf(false, "urgent")).toBe("urgent");
    expect(urgencyOf(false, "none")).toBeNull();
  });

  const add = { score: 0, note: null, upset: false, sales: false, outsideHours: false, topics: [] as string[] };

  it("replaces the lead tag with the latest one", () => {
    expect(mergeTags(["warm lead: comparing", "sales", "channels"], { ...add, score: 75, note: "asked about Pro price", sales: true, topics: ["Pricing"] })).toEqual(["hot lead: asked about Pro price", "sales", "pricing", "channels"]);
    expect(mergeTags(["hot lead: x"], { ...add, score: 55 })).toEqual(["warm lead"]);
    expect(mergeTags(["hot lead: x", "billing"], { ...add, score: 10 })).toEqual(["billing"]);
  });
  it("replaces an older upset tag and adds outside hours", () => {
    expect(mergeTags(["upset: old"], { ...add, upset: true, note: "post failed", outsideHours: true })).toEqual(["upset: post failed", "outside hours"]);
  });
  it("keeps an older upset tag when this message is calm", () => {
    expect(mergeTags(["upset: post failed"], add)).toEqual(["upset: post failed"]);
  });
  it("dedupes and keeps at most 8", () => {
    expect(mergeTags(["sales", "sales"], { ...add, sales: true })).toEqual(["sales"]);
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`);
    expect(mergeTags(many, { ...add, topics: ["new"] })).toHaveLength(8);
    expect(mergeTags(many, { ...add, topics: ["new"] })[0]).toBe("new");
  });
  it("cuts long notes and topics", () => {
    const [tag] = mergeTags([], { ...add, score: 80, note: "x".repeat(100) });
    expect(tag).toBe(`hot lead: ${"x".repeat(60)}`);
    expect(mergeTags([], { ...add, topics: ["y".repeat(50)] })[0]).toHaveLength(30);
  });
  it("sorts upset, then urgent, then hot leads first", () => {
    expect(priorityOf({ urgency: "upset", leadScore: 0 })).toBe(3);
    expect(priorityOf({ urgency: "urgent", leadScore: 90 })).toBe(2);
    expect(priorityOf({ urgency: null, leadScore: 70 })).toBe(1);
    expect(priorityOf({ urgency: null, leadScore: 69 })).toBe(0);
    expect(priorityOf({ urgency: null, leadScore: null })).toBe(0);
  });
});
