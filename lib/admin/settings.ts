import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_CARD_MARGIN_PERCENT, DEFAULT_USD_TO_RWF } from "@/lib/region-format";
import { DEFAULT_BUFFER_MINUTES, DEFAULT_SLOT_MINUTES, isValidYmd } from "@/lib/demo/slots";
import { writeAudit } from "./audit";
import { AdminError, type AdminContext } from "./types";

// The owner's settings (Admin -> Settings), one AdminSetting row per key. A missing row means the default, so a
// fresh database needs no seed. Every change is audited with the old and new value.

/** New sign-ups: how long the trial lasts once an admin starts it after the demo (section 12 of the launch plan). */
export const DEFAULT_TRIAL_DAYS = 3;

export type Settings = {
  /** Trial length in days, used by "Start trial" and by "change_plan to TRIAL". Replaces the TRIAL plan's trialDays for new sign-ups. */
  trialDays: number;
  /** RWF per USD, for the card (Paddle, USD) price of RWF plans. */
  usdToRwf: number;
  /** Added to card prices to cover Paddle's fee and rate changes, in percent. */
  cardMarginPercent: number;
  /** The reusable meeting link (Google Meet) sent with every demo invite. */
  meetingLink: string;
  /** Demo length. */
  slotMinutes: number;
  /** Free time kept on both sides of a demo. */
  bufferMinutes: number;
  /** Days with no demos, YYYY-MM-DD in Africa/Kigali. */
  blockedDates: string[];
};
export type SettingName = keyof Settings;

const KEYS: Record<SettingName, string> = {
  trialDays: "trial.days",
  usdToRwf: "pricing.usdToRwf",
  cardMarginPercent: "pricing.cardMarginPercent",
  meetingLink: "demo.meetingLink",
  slotMinutes: "demo.slotMinutes",
  bufferMinutes: "demo.bufferMinutes",
  blockedDates: "demo.blockedDates",
};

export const DEFAULT_SETTINGS: Settings = {
  trialDays: DEFAULT_TRIAL_DAYS,
  usdToRwf: DEFAULT_USD_TO_RWF,
  cardMarginPercent: DEFAULT_CARD_MARGIN_PERCENT,
  meetingLink: "",
  slotMinutes: DEFAULT_SLOT_MINUTES,
  bufferMinutes: DEFAULT_BUFFER_MINUTES,
  blockedDates: [],
};

const number = (field: string, min: number, max: number, integer = true) => (value: unknown) => {
  const n = typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new AdminError("invalid", `${field} must be a ${integer ? "whole " : ""}number from ${min} to ${max}.`);
  }
  return n;
};

/** Checks a value for a setting and returns it in its stored shape. */
export const cleanSetting: { [K in SettingName]: (value: unknown) => Settings[K] } = {
  trialDays: number("The trial length (days)", 1, 90),
  usdToRwf: number("The USD to RWF rate", 100, 100_000, false),
  cardMarginPercent: number("The card margin (%)", 0, 100, false),
  meetingLink: (value) => {
    const v = String(value ?? "").trim();
    if (!v) return "";
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw new AdminError("invalid", "The meeting link must be a full https:// address.");
    }
    if (url.protocol !== "https:" || v.length > 300) throw new AdminError("invalid", "The meeting link must be a full https:// address.");
    return url.toString();
  },
  slotMinutes: (value) => {
    const n = number("The demo length (minutes)", 15, 120)(value);
    if (n % 5 !== 0) throw new AdminError("invalid", "The demo length must be a multiple of 5 minutes.");
    return n;
  },
  bufferMinutes: number("The buffer (minutes)", 0, 120),
  blockedDates: (value) => {
    const list = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
    const out = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))].sort();
    if (out.length > 200) throw new AdminError("invalid", "At most 200 blocked dates.");
    const bad = out.find((d) => !isValidYmd(d));
    if (bad) throw new AdminError("invalid", `"${bad}" is not a date. Use YYYY-MM-DD, one per line.`);
    return out;
  },
};

function read<K extends SettingName>(name: K, raw: unknown): Settings[K] {
  if (raw === undefined || raw === null) return DEFAULT_SETTINGS[name];
  try {
    return cleanSetting[name](raw);
  } catch {
    return DEFAULT_SETTINGS[name];
  }
}

/** Every setting, defaults filled in. One query. */
export async function getSettings(): Promise<Settings> {
  let rows: { key: string; value: unknown }[] = [];
  try {
    rows = await prisma.adminSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  } catch {
    // A database blip must not stop a booking page or a cron: the defaults apply until the next read.
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_SETTINGS };
  for (const name of Object.keys(KEYS) as SettingName[]) (out as Record<string, unknown>)[name] = read(name, byKey.get(KEYS[name]));
  return out;
}

export async function getSetting<K extends SettingName>(name: K): Promise<Settings[K]> {
  const row = await prisma.adminSetting.findUnique({ where: { key: KEYS[name] } }).catch(() => null);
  return read(name, row?.value);
}

/** Saves one setting (validated), audited as update_setting on setting:<key>. */
export async function setSetting<K extends SettingName>(ctx: AdminContext, name: K, value: unknown): Promise<Settings[K]> {
  const key = KEYS[name];
  const next = cleanSetting[name](value);
  const before = await getSetting(name);
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.upsert({ where: { key }, create: { key, value: next as Prisma.InputJsonValue }, update: { value: next as Prisma.InputJsonValue } });
    await writeAudit(tx, ctx, "update_setting", `setting:${key}`, { value: before }, { value: next });
  });
  return next;
}

export const SETTING_KEYS = KEYS;
