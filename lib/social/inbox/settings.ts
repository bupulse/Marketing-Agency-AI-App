import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";

// The owner's switches for Instagram and Facebook replies (Admin -> Services, "Instagram and Facebook replies"), one
// AdminSetting row each; a missing row means the default. docs/SOCIAL_INBOX.md.
//
// - transport: how comments and DMs arrive and replies leave. "composio" (default): BuPulse-Socials, new items found by
//   checking each switched-on account (due jobs, lib/social/inbox/poll.ts). "meta": BuPulse's own Meta app, Meta's
//   webhooks (app/api/meta/webhook) and the Graph API with each account's own token. Switch to "meta" only once Meta
//   has approved BuPulse (Advanced Access needs a registered business).
// - monthlyCap: Composio calls per month, all businesses together. The inbox check stops before it; replies stop at it.
//   Composio's managed Meta app includes 20,000 of the free 100,000 calls a month, so the default leaves a margin.
// - privateReplyConfirmed: an admin tried a private reply (the first DM to someone who only commented) on a test
//   account and it worked. Off by default: Composio has no tool for it, so it goes through Composio's proxy, which needs
//   Meta permissions (instagram_manage_comments + pages_messaging, or instagram_business_manage_messages, with Advanced
//   Access) that Composio's shared app may not hold.

export type InboxTransport = "composio" | "meta";

export type InboxSettings = {
  transport: InboxTransport;
  monthlyCap: number;
  privateReplyConfirmed: boolean;
};

export const DEFAULT_MONTHLY_CAP = 18_000;
/** The most an admin may set: Composio's managed Meta app includes 20,000 free calls a month. */
export const MAX_MONTHLY_CAP = 20_000;

export const INBOX_SETTING_KEYS = {
  transport: "inbox.meta.transport",
  monthlyCap: "inbox.composio.monthlyCap",
  privateReplyConfirmed: "inbox.privateReply.confirmed",
} as const satisfies Record<keyof InboxSettings, string>;

export const DEFAULT_INBOX_SETTINGS: InboxSettings = { transport: "composio", monthlyCap: DEFAULT_MONTHLY_CAP, privateReplyConfirmed: false };

/** Checks a value for a setting and returns it in its stored shape (throws AdminError with a plain-English reason). */
export const cleanInboxSetting: { [K in keyof InboxSettings]: (value: unknown) => InboxSettings[K] } = {
  transport: (value) => {
    const v = String(value ?? "").trim().toLowerCase();
    if (v !== "composio" && v !== "meta") throw new AdminError("invalid", "Choose BuPulse-Socials (Composio) or Meta direct.");
    return v;
  },
  monthlyCap: (value) => {
    const n = typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : value;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_MONTHLY_CAP) {
      throw new AdminError("invalid", `The monthly limit must be a whole number from 0 to ${MAX_MONTHLY_CAP.toLocaleString("en-US")} (Composio's free calls for Meta).`);
    }
    return n;
  },
  privateReplyConfirmed: (value) => value === true || value === "on" || value === "true" || value === "1",
};

function read<K extends keyof InboxSettings>(name: K, raw: unknown): InboxSettings[K] {
  if (raw === undefined || raw === null) return DEFAULT_INBOX_SETTINGS[name];
  try {
    return cleanInboxSetting[name](raw);
  } catch {
    return DEFAULT_INBOX_SETTINGS[name];
  }
}

const TTL_MS = 15_000;
let cache: { at: number; value: InboxSettings } | null = null;

export function clearInboxSettingsCache() {
  cache = null;
}

/** The last settings read in this process (defaults before the first read). Adapters' capabilities use it. */
export function cachedInboxSettings(): InboxSettings {
  return cache?.value ?? DEFAULT_INBOX_SETTINGS;
}

/** Every inbox setting, defaults filled in. Cached for a few seconds; a database blip keeps the last good answer. */
export async function getInboxSettings(): Promise<InboxSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const rows = await prisma.adminSetting.findMany({ where: { key: { in: Object.values(INBOX_SETTING_KEYS) } } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const value = {} as InboxSettings;
    for (const name of Object.keys(INBOX_SETTING_KEYS) as (keyof InboxSettings)[]) (value as Record<string, unknown>)[name] = read(name, byKey.get(INBOX_SETTING_KEYS[name]));
    cache = { at: Date.now(), value };
  } catch {
    cache = { at: Date.now(), value: cache?.value ?? DEFAULT_INBOX_SETTINGS };
  }
  return cache.value;
}

/** Saves one setting (validated), audited as update_setting on setting:<key>. */
export async function setInboxSetting<K extends keyof InboxSettings>(ctx: AdminContext, name: K, value: unknown): Promise<InboxSettings[K]> {
  const key = INBOX_SETTING_KEYS[name];
  const next = cleanInboxSetting[name](value);
  clearInboxSettingsCache();
  const before = (await getInboxSettings())[name];
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.upsert({ where: { key }, create: { key, value: next as Prisma.InputJsonValue }, update: { value: next as Prisma.InputJsonValue } });
    await writeAudit(tx, ctx, "update_setting", `setting:${key}`, { value: before }, { value: next });
  });
  clearInboxSettingsCache();
  return next;
}
