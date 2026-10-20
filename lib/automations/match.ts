import { COMMENT_TRIGGERS, type Channel, type ConditionRule, type TriggerData, type TriggerKind } from "./graph";

// Pure rules of the engine, kept apart so they are easy to test: which live automation a message starts, the
// variables in message texts, and conditions.

/** Lower case, no accents, single spaces: "Prix  ÉTÉ" and "prix ete" are the same keyword. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#@]+/gu, " ")
    .trim();
}

/** Does `text` contain `keyword` as whole words ("price" matches "what is the price?" but not "priceless")? */
export function hasKeyword(text: string, keyword: string, match: "contains" | "exact"): boolean {
  const t = fold(text);
  const k = fold(keyword);
  if (!k) return false;
  if (match === "exact") return t === k;
  return ` ${t} `.includes(` ${k} `);
}

export type TriggerInput = {
  channel: Channel;
  kind: "MESSAGE" | "COMMENT" | "STORY_MENTION";
  text: string;
  postExternalId?: string | null;
  /** True when this is the first message the contact ever sent on this conversation. */
  firstMessage: boolean;
};

export type LiveAutomation = { id: string; trigger: TriggerData; updatedAt?: Date };

/** How specific a match is: the most specific automation wins (an exact keyword beats "any message"). */
const RANK: Record<TriggerKind, number> = { keyword: 50, comment_keyword: 50, story_mention: 40, any_comment: 30, first_message: 20, default_reply: 10 };

/** The score of an automation for this input, or 0 when it does not start. */
export function triggerScore(trigger: TriggerData, input: TriggerInput): number {
  if (!trigger.channels.includes(input.channel)) return 0;
  const isComment = input.kind === "COMMENT";
  if (COMMENT_TRIGGERS.includes(trigger.kind) !== isComment) return 0;
  if (trigger.kind === "story_mention") return input.kind === "STORY_MENTION" ? RANK.story_mention : 0;
  if (input.kind === "STORY_MENTION") return 0;
  if (isComment && trigger.postIds.length && (!input.postExternalId || !trigger.postIds.includes(input.postExternalId))) return 0;
  switch (trigger.kind) {
    case "keyword":
    case "comment_keyword": {
      const hit = trigger.keywords.filter((k) => hasKeyword(input.text, k, trigger.match));
      if (!hit.length) return 0;
      // Exact beats contains; a longer keyword beats a shorter one ("price list" over "price").
      return RANK[trigger.kind] + (trigger.match === "exact" ? 5 : 0) + Math.min(4, Math.max(...hit.map((k) => fold(k).split(" ").length)));
    }
    case "any_comment":
      return RANK.any_comment + (trigger.postIds.length ? 5 : 0);
    case "first_message":
      return input.firstMessage ? RANK.first_message : 0;
    case "default_reply":
      return RANK.default_reply;
  }
}

/** The live automation this input starts, or null. Ties go to the most recently changed automation. */
export function pickAutomation<T extends LiveAutomation>(automations: T[], input: TriggerInput): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const a of automations) {
    const score = triggerScore(a.trigger, input);
    if (score > bestScore || (score === bestScore && score > 0 && best && (a.updatedAt?.getTime() ?? 0) > (best.updatedAt?.getTime() ?? 0))) {
      best = a;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export type ContactVars = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  fields?: Record<string, unknown>;
  business?: string | null;
};

/** Fills {{first_name}}, {{name}}, {{email}}, {{phone}}, {{business}} and {{field.key}}; unknown ones become empty. */
export function renderText(template: string, vars: ContactVars): string {
  const first = (vars.name ?? "").trim().split(/\s+/)[0] ?? "";
  const out = template.replace(/\{\{\s*([a-z_]+(?:\.[a-z0-9_]+)?)\s*\}\}/gi, (_, raw: string) => {
    const key = raw.toLowerCase();
    if (key === "first_name") return first;
    if (key === "name") return vars.name ?? "";
    if (key === "email") return vars.email ?? "";
    if (key === "phone") return vars.phone ?? "";
    if (key === "business") return vars.business ?? "";
    if (key.startsWith("field.")) {
      const v = vars.fields?.[key.slice(6)];
      return v === undefined || v === null ? "" : String(v);
    }
    return "";
  });
  // "Hi {{first_name}}!" for someone without a name reads "Hi !": tidy the gap.
  return out.replace(/ +([!?.,])/g, "$1").replace(/ {2,}/g, " ").trim();
}

export type ConditionContext = {
  tags: string[];
  fields: Record<string, unknown>;
  email?: string | null;
  phone?: string | null;
  channel: Channel;
  lastText: string;
};

export function ruleHolds(rule: ConditionRule, ctx: ConditionContext): boolean {
  const tagSet = new Set(ctx.tags.map((t) => fold(t)));
  switch (rule.kind) {
    case "has_tag":
      return tagSet.has(fold(rule.value));
    case "no_tag":
      return !tagSet.has(fold(rule.value));
    case "field_equals":
      return fold(String(ctx.fields[rule.key] ?? "")) === fold(rule.value);
    case "field_set":
      return String(ctx.fields[rule.key] ?? "").trim() !== "";
    case "has_email":
      return !!ctx.email;
    case "has_phone":
      return !!ctx.phone;
    case "channel_is":
      return ctx.channel === rule.value;
    case "text_contains":
      return hasKeyword(ctx.lastText, rule.value, "contains");
  }
}

export function conditionHolds(rules: ConditionRule[], mode: "all" | "any", ctx: ConditionContext): boolean {
  return mode === "all" ? rules.every((r) => ruleHolds(r, ctx)) : rules.some((r) => ruleHolds(r, ctx));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Checks an answer to a question step; returns the cleaned value or null when it is not valid. */
export function validateAnswer(answer: string, rule: "any" | "email" | "phone" | "number"): string | null {
  const value = answer.trim();
  if (!value) return null;
  if (rule === "email") {
    const found = value.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/)?.[0];
    return found && EMAIL.test(found) ? found.toLowerCase() : null;
  }
  if (rule === "phone") {
    const digits = value.replace(/[^\d+]/g, "");
    return digits.replace(/\D/g, "").length >= 9 ? digits : null;
  }
  if (rule === "number") {
    const n = value.replace(/[\s,]/g, "").match(/-?\d+(\.\d+)?/)?.[0];
    return n ?? null;
  }
  return value.slice(0, 500);
}

/** Adds the buttons as numbered lines for channels that cannot show buttons ("Reply 1 for ..."). */
export function messageForChannel(text: string, buttons: { id: string; title: string; url?: string }[], canButtons: boolean): { text: string; buttons?: { id: string; title: string; url?: string }[] } {
  if (!buttons.length || canButtons) return { text, buttons: buttons.length ? buttons : undefined };
  const lines = buttons.map((b, i) => (b.url ? `${b.title}: ${b.url}` : `${i + 1}. ${b.title}`));
  return { text: `${text}\n\n${lines.join("\n")}` };
}

/** Which button an answer means: the tapped id, the title typed, or its number. */
export function buttonFor(answer: { text: string; buttonId?: string }, buttons: { id: string; title: string }[]): string | null {
  if (answer.buttonId && buttons.some((b) => b.id === answer.buttonId)) return answer.buttonId;
  const t = answer.text.trim();
  const n = Number(t.replace(/[.)]$/, ""));
  if (Number.isInteger(n) && n >= 1 && n <= buttons.length) return buttons[n - 1].id;
  return buttons.find((b) => hasKeyword(t, b.title, "exact"))?.id ?? null;
}
