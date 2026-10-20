// Daily posts made for you (docs/CONTENT.md "Daily posts"): the company's choices in Content -> Settings. Stored as
// Business.dailyPostSettings (JSON), validated here. Pure and client-safe, so the page, the actions, the cron and the
// tests share it. Missing or unreadable means the defaults: on, one post per app, the connected apps, free designs.
import { z } from "zod";
import { dayKey } from "@/lib/publishing/time";
import { NETWORKS, type Network } from "@/lib/social/types";

export type DailyDesign = "free" | "ai";

export interface DailyPostSettings {
  /** On by default for the companies whose plan has it. */
  enabled: boolean;
  /** Posts per app each day: 1 by default, up to the plan's posts per app per day. */
  perApp: number;
  /** The apps to make posts for; null: the connected ones (Instagram and Facebook while none is connected). */
  apps: Network[] | null;
  /** Free designs (your photos and BuPulse designs) by default; AI photos only while the plan's images last. */
  design: DailyDesign;
}

export const DEFAULT_DAILY_SETTINGS: DailyPostSettings = { enabled: true, perApp: 1, apps: null, design: "free" };

/** The apps a company with no connected app gets posts for (reminders to post them yourself until connected). */
export const DEFAULT_DAILY_APPS: readonly Network[] = ["instagram", "facebook"];

export const dailySettingsSchema = z
  .object({
    enabled: z.boolean(),
    perApp: z.number().int().min(1).max(10),
    apps: z.array(z.enum(NETWORKS as unknown as [Network, ...Network[]])).min(1, "Choose at least one app.").max(NETWORKS.length).nullable(),
    design: z.enum(["free", "ai"]),
  })
  .strict();

export type DailySettingsInput = z.input<typeof dailySettingsSchema>;

/** The stored JSON as full settings; anything unreadable falls back to the default, field by field. */
export function readDailySettings(value: unknown): DailyPostSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const field = <K extends keyof DailyPostSettings>(key: K): DailyPostSettings[K] => {
    const parsed = dailySettingsSchema.shape[key].safeParse(v[key]);
    return parsed.success ? (parsed.data as DailyPostSettings[K]) : DEFAULT_DAILY_SETTINGS[key];
  };
  const apps = field("apps");
  return { enabled: field("enabled"), perApp: field("perApp"), apps: apps ? NETWORKS.filter((n) => apps.includes(n)) : null, design: field("design") };
}

/** The apps a day's run makes posts for: the chosen ones, else the connected ones, else Instagram and Facebook. */
export function dailyApps(settings: Pick<DailyPostSettings, "apps">, connected: readonly Network[]): Network[] {
  if (settings.apps?.length) return [...settings.apps];
  const usable = NETWORKS.filter((n) => connected.includes(n));
  return usable.length ? usable : [...DEFAULT_DAILY_APPS];
}

/** What the post card says about a daily post: "Made for you this morning" on its day, "Made for you" after. */
export function dailyPostLabel(createdAt: string, zone: string, now: Date = new Date()): string {
  return dayKey(new Date(createdAt), zone) === dayKey(now, zone) ? "Made for you this morning" : "Made for you";
}
