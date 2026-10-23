import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { can, type AdminIdentity } from "@/lib/admin/auth";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import type { Hours } from "./contract";

// The support chat's settings (Admin -> Live chat): team hours, page greetings, AI rules and the WhatsApp number. One
// AdminSetting row; a missing or broken row means the defaults, so a fresh database needs no seed. Admin saves it
// through saveSupportSettings (which audits); the API reads it through getSupportSettings (cached 30 s).

export const SUPPORT_SETTINGS_KEY = "support.settings";
const ZONE = "Africa/Kigali";

const range = z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) });

export const supportSettingsSchema = z.object({
  /** Team hours, Kigali time, by weekday (0 = Sunday … 6 = Saturday); a missing day = closed. */
  hours: z.record(z.string().regex(/^[0-6]$/), z.array(range).max(4)),
  /** Greeting per page: the first rule whose prefix matches the path wins; "*" is the fallback. */
  greetings: z.array(z.object({ path: z.string().max(200), text: z.string().trim().min(1).max(200), delaySec: z.number().int().min(5).max(600), quickReplies: z.array(z.string().trim().min(1).max(60)).max(3) })).max(30),
  aiEnabled: z.boolean(),
  /** Tone and policy notes for the AI, kept apart from the guide. */
  aiRules: z.string().max(4000),
  /** Topics the AI always hands to a person. */
  handoverTopics: z.array(z.string().trim().min(1).max(80)).max(30),
  /** Support WhatsApp number (E.164) for "Continue on WhatsApp"; empty hides the button. */
  whatsapp: z.string().max(20),
});
export type SupportSettings = z.infer<typeof supportSettingsSchema>;

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  hours: Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((d) => [d, [{ from: "08:00", to: "20:00" }]])),
  greetings: [
    { path: "/pricing", text: "Questions about plans? Ask me anything about BuPulse.", delaySec: 30, quickReplies: ["Which plan fits me?", "How does the trial work?"] },
    { path: "/signup", text: "Need a hand getting started? I can help.", delaySec: 30, quickReplies: ["How does the trial work?"] },
    { path: "/dashboard", text: "Stuck on something? Ask me, I know BuPulse inside out.", delaySec: 15, quickReplies: [] },
    { path: "*", text: "Hi! Questions about BuPulse? Ask me anything.", delaySec: 15, quickReplies: ["What does BuPulse do?", "How much does it cost?"] },
  ],
  aiEnabled: true,
  aiRules: "Be warm, short and clear. Never invent prices, dates or features: say you are not sure and offer a person.",
  handoverTopics: ["refunds", "payment confirmation", "account deletion", "legal questions", "payment disputes"],
  whatsapp: "",
};

let cache: { at: number; value: SupportSettings } | null = null;

export async function getSupportSettings(): Promise<SupportSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  let value = DEFAULT_SUPPORT_SETTINGS;
  try {
    const row = await prisma.adminSetting.findUnique({ where: { key: SUPPORT_SETTINGS_KEY } });
    const parsed = row ? supportSettingsSchema.safeParse(row.value) : null;
    if (parsed?.success) value = parsed.data;
  } catch {
    if (cache) return cache.value; // keep the last good value through a database blip
  }
  cache = { at: Date.now(), value };
  return value;
}

export function clearSupportSettingsCache() {
  cache = null;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Kigali weekday and minutes after midnight for an instant (Rwanda has no daylight saving). */
function kigali(now: Date): { day: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, min: Number(get("hour")) * 60 + Number(get("minute")) };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Whether the team is open now, when it closes or next opens, and a short label for the chat header. */
export function teamHours(settings: Pick<SupportSettings, "hours">, now = new Date()): Hours {
  const { day, min } = kigali(now);
  const today = settings.hours[String(day)] ?? [];
  const current = today.find((r) => min >= minutes(r.from) && min < minutes(r.to));
  if (current) return { open: true, opensAt: null, closesAt: current.to, timezone: ZONE, label: `team open until ${current.to}` };
  const later = today.find((r) => minutes(r.from) > min);
  if (later) return { open: false, opensAt: later.from, closesAt: null, timezone: ZONE, label: `team opens at ${later.from}` };
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    const first = settings.hours[String(d)]?.[0];
    if (first) return { open: false, opensAt: first.from, closesAt: null, timezone: ZONE, label: i === 1 ? `team opens tomorrow at ${first.from}` : `team opens ${DAY_NAMES[d]} at ${first.from}` };
  }
  return { open: false, opensAt: null, closesAt: null, timezone: ZONE, label: "the team replies by email" };
}

/** The greeting rule for a path: the longest matching prefix, else "*". */
export function greetingFor(settings: Pick<SupportSettings, "greetings">, path: string) {
  const matches = settings.greetings.filter((g) => g.path !== "*" && (path === g.path || path.startsWith(`${g.path}/`)));
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0] ?? settings.greetings.find((g) => g.path === "*") ?? null;
}

// ---------- Saving (Admin -> Live chat) ----------

const E164 = /^\+[1-9]\d{7,14}$/;
const validTime = (hhmm: string) => Number(hhmm.slice(0, 2)) <= 24 && Number(hhmm.slice(3, 5)) <= 59 && (hhmm.slice(0, 2) !== "24" || hhmm === "24:00");

/** Problems a person can fix, in plain words; empty when the settings can be saved. */
export function supportSettingsProblems(value: SupportSettings): string[] {
  const out: string[] = [];
  for (const [day, ranges] of Object.entries(value.hours)) {
    const name = DAY_NAMES[Number(day)];
    const sorted = [...ranges].sort((a, b) => minutes(a.from) - minutes(b.from));
    for (const r of sorted) {
      if (!validTime(r.from) || !validTime(r.to)) out.push(`${name}: use times like 08:00 or 20:30.`);
      else if (minutes(r.from) >= minutes(r.to)) out.push(`${name}: ${r.from} to ${r.to} ends before it starts.`);
    }
    for (let i = 1; i < sorted.length; i++) if (minutes(sorted[i].from) < minutes(sorted[i - 1].to)) out.push(`${name}: two time ranges overlap.`);
  }
  const paths = value.greetings.map((g) => g.path.trim());
  if (paths.some((p) => p !== "*" && !p.startsWith("/"))) out.push('Greeting pages start with "/" (for example /pricing), or are "*" for every other page.');
  if (new Set(paths).size !== paths.length) out.push("Each page can have one greeting only.");
  if (value.whatsapp && !E164.test(value.whatsapp)) out.push("WhatsApp number: write it with the country code, like +250788000000, or leave it empty.");
  return out;
}

/**
 * Saves the settings (owner, or staff with the liveChat permission), audited with the before and after. Refuses
 * anything the schema or supportSettingsProblems rejects; the API sees the change within 30 seconds (this server: now).
 */
export async function saveSupportSettings(ctx: AdminContext, actor: Pick<AdminIdentity, "permissions">, input: unknown): Promise<SupportSettings> {
  if (!can(actor, "liveChat")) throw new AdminError("forbidden", "You need the Live chat permission for this.");
  const parsed = supportSettingsSchema.safeParse(input);
  if (!parsed.success) throw new AdminError("invalid", "Some settings are not valid. Check the times, greetings and number, then save again.");
  const value = { ...parsed.data, whatsapp: parsed.data.whatsapp.replace(/[\s-]/g, "") };
  const problems = supportSettingsProblems(value);
  if (problems.length) throw new AdminError("invalid", problems[0]);
  const row = await prisma.adminSetting.findUnique({ where: { key: SUPPORT_SETTINGS_KEY } });
  const before = row ? supportSettingsSchema.safeParse(row.value) : null;
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.upsert({ where: { key: SUPPORT_SETTINGS_KEY }, create: { key: SUPPORT_SETTINGS_KEY, value }, update: { value } });
    await writeAudit(tx, ctx, "support_settings_save", `setting:${SUPPORT_SETTINGS_KEY}`, before?.success ? before.data : null, value);
  });
  clearSupportSettingsCache();
  return value;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Sat 08:00–20:00 Kigali": days in a row with the same hours are joined (stats header, guide). */
export function hoursSummary(settings: Pick<SupportSettings, "hours">): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const label = (d: number) => (settings.hours[String(d)] ?? []).map((r) => `${r.from}–${r.to}`).join(", ");
  const parts: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const hours = label(order[i]);
    if (!hours) continue;
    let j = i;
    while (j + 1 < order.length && label(order[j + 1]) === hours) j++;
    parts.push(`${SHORT_DAYS[order[i]]}${j > i ? `–${SHORT_DAYS[order[j]]}` : ""} ${hours}`);
    i = j;
  }
  return parts.length ? `${parts.join(", ")} Kigali` : "no team hours set";
}
