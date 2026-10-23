// Admin -> Live chat forms into support settings (lib/support/settings.ts). Pure: no server imports, so the tests run
// them directly. Each parser returns only its own tab's fields; the action merges them into the saved settings and
// saveSupportSettings checks everything again (times that overlap, page paths, the WhatsApp number). Problems a person
// can fix are AdminErrors in plain words, so the page shows them as they are.
import { AdminError } from "@/lib/admin/types";
import type { SupportSettings } from "./settings";

type Form = Pick<FormData, "get" | "keys">;

/** Monday first, as people read a week; the keys are the saved weekday numbers (0 = Sunday). */
export const WEEKDAYS = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "0", label: "Sunday" },
] as const;

export const GREETING_LIMITS = { max: 30, text: 200, path: 200, minDelay: 5, maxDelay: 600, replies: 3, reply: 60, defaultDelay: 15 } as const;
export const AI_LIMITS = { rules: 4000, topics: 30, topic: 80 } as const;

const text = (f: Form, k: string) => String(f.get(k) ?? "").trim();
const ticked = (f: Form, k: string) => ["on", "1", "true"].includes(text(f, k));
const lines = (raw: string) => raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * Team hours: per weekday `open_<d>` (checkbox), `from_<d>` and `to_<d>` (HH:MM). The form shows one range per day;
 * any further ranges already saved for an open day are kept. A closed day is left out (missing = closed).
 */
export function hoursFromForm(f: Form, current: SupportSettings["hours"]): SupportSettings["hours"] {
  const out: SupportSettings["hours"] = {};
  for (const { key, label } of WEEKDAYS) {
    if (!ticked(f, `open_${key}`)) continue;
    const from = text(f, `from_${key}`);
    const to = text(f, `to_${key}`);
    if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) throw new AdminError("invalid", `${label}: pick the opening and closing time, or untick the day.`);
    out[key] = [{ from, to }, ...(current[key] ?? []).slice(1)];
  }
  return out;
}

/**
 * Greetings: rows `g_path_<i>`, `g_text_<i>`, `g_delay_<i>` (seconds), `g_replies_<i>` (one quick reply per line) and
 * `g_remove_<i>` (checkbox). A row left fully blank (the "add one" row) is skipped; rows keep their order on the page.
 */
export function greetingsFromForm(f: Form): SupportSettings["greetings"] {
  const rows = [...new Set([...f.keys()].flatMap((k) => /^g_path_(\d+)$/.exec(k)?.[1] ?? []))].map(Number).sort((a, b) => a - b);
  const out: SupportSettings["greetings"] = [];
  for (const i of rows) {
    if (ticked(f, `g_remove_${i}`)) continue;
    const path = text(f, `g_path_${i}`);
    const body = text(f, `g_text_${i}`).replace(/\s+/g, " ");
    const delayRaw = text(f, `g_delay_${i}`);
    const quickReplies = lines(String(f.get(`g_replies_${i}`) ?? ""));
    if (!path && !body && !quickReplies.length) continue;
    const where = path ? `Greeting for ${path}` : "A greeting";
    if (!path) throw new AdminError("invalid", `${where}: write the page it shows on (for example /pricing), or "*" for every other page.`);
    if (path.length > GREETING_LIMITS.path) throw new AdminError("invalid", `${where}: the page path is too long.`);
    if (!body) throw new AdminError("invalid", `${where}: write the text people see.`);
    if (body.length > GREETING_LIMITS.text) throw new AdminError("invalid", `${where}: keep the text under ${GREETING_LIMITS.text} characters.`);
    const delaySec = delayRaw === "" ? GREETING_LIMITS.defaultDelay : Number(delayRaw);
    if (!Number.isInteger(delaySec) || delaySec < GREETING_LIMITS.minDelay || delaySec > GREETING_LIMITS.maxDelay) throw new AdminError("invalid", `${where}: show it after ${GREETING_LIMITS.minDelay} to ${GREETING_LIMITS.maxDelay} seconds.`);
    if (quickReplies.length > GREETING_LIMITS.replies) throw new AdminError("invalid", `${where}: up to ${GREETING_LIMITS.replies} quick replies.`);
    if (quickReplies.some((r) => r.length > GREETING_LIMITS.reply)) throw new AdminError("invalid", `${where}: keep each quick reply under ${GREETING_LIMITS.reply} characters.`);
    out.push({ path, text: body, delaySec, quickReplies });
  }
  if (out.length > GREETING_LIMITS.max) throw new AdminError("invalid", `Up to ${GREETING_LIMITS.max} greetings.`);
  return out;
}

/** AI rules: `aiEnabled` (checkbox), `aiRules`, `handoverTopics` (one per line, duplicates dropped) and `whatsapp`. */
export function aiFromForm(f: Form): Pick<SupportSettings, "aiEnabled" | "aiRules" | "handoverTopics" | "whatsapp"> {
  const aiRules = String(f.get("aiRules") ?? "").replace(/\r\n/g, "\n").trim();
  if (aiRules.length > AI_LIMITS.rules) throw new AdminError("invalid", `Keep the AI rules under ${AI_LIMITS.rules} characters.`);
  const seen = new Set<string>();
  const handoverTopics = lines(String(f.get("handoverTopics") ?? "")).filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)));
  if (handoverTopics.length > AI_LIMITS.topics) throw new AdminError("invalid", `Up to ${AI_LIMITS.topics} hand-over topics.`);
  if (handoverTopics.some((t) => t.length > AI_LIMITS.topic)) throw new AdminError("invalid", `Keep each hand-over topic under ${AI_LIMITS.topic} characters.`);
  return { aiEnabled: ticked(f, "aiEnabled"), aiRules, handoverTopics, whatsapp: text(f, "whatsapp").replace(/[\s-]/g, "") };
}
