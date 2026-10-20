import { graphSchema, type Channel, type Graph } from "./graph";

// Ready-made automations for the common jobs of small businesses in Rwanda ("comment PRICE", a welcome menu, booking
// a visit, AI answers, a giveaway, a follow-up). The owner picks one, changes the words and publishes. Pure data, shared
// by the template gallery (browser) and the create action (server). docs/AUTOMATIONS.md.

export type Template = {
  key: string;
  name: string;
  description: string;
  /** Who it suits, shown on the card. */
  bestFor: string;
  channels: Channel[];
  /** Needs Instagram or Facebook connected (comment templates). */
  social: boolean;
  graph: () => Graph;
};

const y = (row: number) => ({ x: 0, y: row * 170 });
const side = (row: number, col: number) => ({ x: col * 300, y: row * 170 });

export const TEMPLATES: Template[] = [
  {
    key: "comment_price",
    name: "Comment PRICE, get the price in DM",
    description: "Someone comments PRICE (or IGICIRO) under your post: they get a public reply and the price in their DMs, with a button to order and their number saved.",
    bestFor: "Shops selling on Instagram and Facebook",
    channels: ["INSTAGRAM", "FACEBOOK"],
    social: true,
    graph: () =>
      graphSchema.parse({
        nodes: [
          { id: "trigger", type: "trigger", position: y(0), data: { kind: "comment_keyword", channels: ["INSTAGRAM", "FACEBOOK"], keywords: ["price", "igiciro", "prix", "how much"], publicReplies: ["Sent you a DM 📩", "Check your DMs 😊"] } },
          { id: "price", type: "message", position: y(1), data: { text: "Hi {{first_name}}! This one is [write the price, e.g. 25,000 RWF]. We deliver in Kigali. Do you want to order?", buttons: [{ id: "order", title: "Order now" }, { id: "more", title: "See more" }] } },
          { id: "phone", type: "question", position: side(2, 0), data: { text: "Great! What is your phone number? We will call you to confirm.", saveTo: "phone", validate: "phone", retryText: "Please send a phone number like 0788 123 456.", timeoutMinutes: 1440 } },
          { id: "more", type: "message", position: side(2, 1), data: { text: "Here are our other products: [write a link or a short list].", buttons: [] } },
          { id: "save", type: "action", position: side(3, 0), data: { actions: [{ kind: "add_tag", tag: "Wants to order" }, { kind: "save_lead", value: "Order from a comment" }] } },
          { id: "thanks", type: "message", position: side(4, 0), data: { text: "Thank you! We will call you soon on {{phone}}.", buttons: [] } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "price" },
          { id: "e2", source: "price", sourceHandle: "order", target: "phone" },
          { id: "e3", source: "price", sourceHandle: "more", target: "more" },
          { id: "e4", source: "phone", sourceHandle: "answered", target: "save" },
          { id: "e5", source: "save", target: "thanks" },
        ],
      }),
  },
  {
    key: "welcome_menu",
    name: "Welcome menu",
    description: "Greets people the first time they write and offers three choices: prices, where you are, or talk to the team.",
    bestFor: "Every business",
    channels: ["WEBSITE", "INSTAGRAM", "FACEBOOK"],
    social: false,
    graph: () =>
      graphSchema.parse({
        nodes: [
          { id: "trigger", type: "trigger", position: y(0), data: { kind: "first_message", channels: ["WEBSITE", "INSTAGRAM", "FACEBOOK"] } },
          { id: "menu", type: "message", position: y(1), data: { text: "Muraho! Welcome to {{business}}. How can we help you today?", buttons: [{ id: "prices", title: "Prices" }, { id: "where", title: "Where are you?" }, { id: "team", title: "Talk to us" }] } },
          { id: "prices", type: "message", position: side(2, 0), data: { text: "Our prices: [write your main prices here].", buttons: [] } },
          { id: "where", type: "message", position: side(2, 1), data: { text: "We are at [address]. Open [days and hours].", buttons: [] } },
          { id: "team", type: "handover", position: side(2, 2), data: { text: "Someone from our team will answer you shortly.", note: "Asked to talk to the team", pauseHours: 24 } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "menu" },
          { id: "e2", source: "menu", sourceHandle: "prices", target: "prices" },
          { id: "e3", source: "menu", sourceHandle: "where", target: "where" },
          { id: "e4", source: "menu", sourceHandle: "team", target: "team" },
        ],
      }),
  },
  {
    key: "book_visit",
    name: "Book a visit or appointment",
    description: "When someone writes BOOK or VISIT, collect their name, phone and preferred day, save them as a lead and alert your team.",
    bestFor: "Real estate, salons, clinics, restaurants",
    channels: ["WEBSITE", "INSTAGRAM", "FACEBOOK"],
    social: false,
    graph: () =>
      graphSchema.parse({
        nodes: [
          { id: "trigger", type: "trigger", position: y(0), data: { kind: "keyword", channels: ["WEBSITE", "INSTAGRAM", "FACEBOOK"], keywords: ["book", "visit", "appointment", "rendez-vous", "gusura"] } },
          { id: "name", type: "question", position: y(1), data: { text: "Happy to book it for you! What is your name?", saveTo: "name", validate: "any" } },
          { id: "phone", type: "question", position: y(2), data: { text: "Thanks {{first_name}}. Your phone number?", saveTo: "phone", validate: "phone", retryText: "Please send a phone number like 0788 123 456." } },
          { id: "day", type: "question", position: y(3), data: { text: "Which day and time suit you best?", saveTo: "field", fieldKey: "preferred_day", validate: "any" } },
          { id: "save", type: "action", position: y(4), data: { actions: [{ kind: "save_lead", value: "Booking request" }, { kind: "notify_team", value: "New booking request: please confirm the time." }] } },
          { id: "done", type: "message", position: y(5), data: { text: "Thank you! We will confirm your booking on {{phone}} soon.", buttons: [] } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "name" },
          { id: "e2", source: "name", sourceHandle: "answered", target: "phone" },
          { id: "e3", source: "phone", sourceHandle: "answered", target: "day" },
          { id: "e4", source: "day", sourceHandle: "answered", target: "save" },
          { id: "e5", source: "save", target: "done" },
        ],
      }),
  },
  {
    key: "ai_answers",
    name: "Answer anything with AI",
    description: "Any message no other automation answers gets an AI reply from your knowledge base, which also asks for a phone number when the person is interested.",
    bestFor: "Businesses with many questions",
    channels: ["INSTAGRAM", "FACEBOOK"],
    social: false,
    graph: () =>
      graphSchema.parse({
        nodes: [
          { id: "trigger", type: "trigger", position: y(0), data: { kind: "default_reply", channels: ["INSTAGRAM", "FACEBOOK"] } },
          { id: "ai", type: "ai", position: y(1), data: { goal: "Answer the question from our business facts. If they want to buy or book, get their phone number.", maxTurns: 4 } },
          { id: "check", type: "condition", position: y(2), data: { rules: [{ kind: "has_phone" }], mode: "all" } },
          { id: "lead", type: "action", position: side(3, 0), data: { actions: [{ kind: "save_lead", value: "From an AI conversation" }] } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "ai" },
          { id: "e2", source: "ai", sourceHandle: "done", target: "check" },
          { id: "e3", source: "check", sourceHandle: "yes", target: "lead" },
        ],
      }),
  },
  {
    key: "giveaway",
    name: "Giveaway",
    description: "People comment WIN under your giveaway post: they get the rules in DM and are tagged as entrants, so you can pick a winner from Contacts.",
    bestFor: "Growing your audience",
    channels: ["INSTAGRAM", "FACEBOOK"],
    social: true,
    graph: () =>
      graphSchema.parse({
        nodes: [
          { id: "trigger", type: "trigger", position: y(0), data: { kind: "comment_keyword", channels: ["INSTAGRAM", "FACEBOOK"], keywords: ["win", "tsinda", "gagner"], publicReplies: ["You're in! Check your DMs 🎉"] } },
          { id: "rules", type: "message", position: y(1), data: { text: "You're entered, {{first_name}}! To win: follow us and share the post. We announce the winner on [date].", buttons: [{ id: "ok", title: "Done ✅" }] } },
          { id: "tag", type: "action", position: y(2), data: { actions: [{ kind: "add_tag", tag: "Giveaway entrant" }] } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "rules" },
          { id: "e2", source: "rules", sourceHandle: "ok", target: "tag" },
        ],
      }),
  },
  {
    key: "follow_up",
    name: "Follow up the next day",
    description: "After sending the price, wait a day and ask if they are still interested. Those who say yes go to your team.",
    bestFor: "Turning questions into sales",
    channels: ["WEBSITE", "INSTAGRAM", "FACEBOOK"],
    social: false,
    graph: () =>
      graphSchema.parse({
        nodes: [
          { id: "trigger", type: "trigger", position: y(0), data: { kind: "keyword", channels: ["WEBSITE", "INSTAGRAM", "FACEBOOK"], keywords: ["price", "igiciro", "prix"] } },
          { id: "price", type: "message", position: y(1), data: { text: "Our prices: [write your prices here].", buttons: [] } },
          { id: "wait", type: "wait", position: y(2), data: { minutes: 1380 } },
          { id: "ask", type: "message", position: y(3), data: { text: "Hi {{first_name}}, are you still interested? We can reserve one for you today.", buttons: [{ id: "yes", title: "Yes please" }, { id: "no", title: "Not now" }] } },
          { id: "team", type: "handover", position: side(4, 0), data: { text: "Great! Someone from our team will contact you now.", note: "Interested after the follow-up", pauseHours: 24 } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "price" },
          { id: "e2", source: "price", target: "wait" },
          { id: "e3", source: "wait", target: "ask" },
          { id: "e4", source: "ask", sourceHandle: "yes", target: "team" },
        ],
      }),
  },
];

export function templateByKey(key: string): Template | null {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}
