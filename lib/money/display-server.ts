import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/admin/settings";
import { logError } from "@/lib/errors";
import { isDisplayCurrency, parseFrankfurter, type MoneyDisplay } from "./display";

// Where the admin console's display currency comes from (docs/ADMIN.md, "Currency"): the admin's own pick (a cookie
// set by the header switch), else Admin -> Settings "Default currency"; the rates from Settings, with the day's ECB
// EUR rate when its refresh is switched on (and fresh), else the stored EUR rate.

export const ADMIN_CURRENCY_COOKIE = "bp_admin_currency";
/** The day's ECB EUR rate, as fetched: { rate, fetchedAt }. Not a Settings field (nobody types it). */
export const EUR_LIVE_KEY = "pricing.usdToEurLive";
const LIVE_MAX_AGE_MS = 3 * 86_400_000;
export const FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR";

type Live = { rate: number; fetchedAt: string };
const readLive = (v: unknown): Live | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  return o && typeof o.rate === "number" && o.rate > 0 && typeof o.fetchedAt === "string" ? { rate: o.rate, fetchedAt: o.fetchedAt } : null;
};

/** The EUR rate in use: the fetched ECB rate when the refresh is on and the rate is under 3 days old, else the stored one. */
export async function effectiveUsdToEur(settings: { usdToEur: number; eurRateAuto: boolean }, now: Date = new Date()): Promise<{ rate: number; source: "ecb" | "settings"; fetchedAt: string | null }> {
  if (!settings.eurRateAuto) return { rate: settings.usdToEur, source: "settings", fetchedAt: null };
  const row = await prisma.adminSetting.findUnique({ where: { key: EUR_LIVE_KEY } }).catch(() => null);
  const live = readLive(row?.value);
  if (live && now.getTime() - new Date(live.fetchedAt).getTime() < LIVE_MAX_AGE_MS) return { rate: live.rate, source: "ecb", fetchedAt: live.fetchedAt };
  return { rate: settings.usdToEur, source: "settings", fetchedAt: live?.fetchedAt ?? null };
}

/** The admin default currency (Settings) and the rates, with no admin's own pick: the sales room TV. */
export async function defaultMoney(): Promise<MoneyDisplay> {
  const settings = await getSettings();
  const eur = await effectiveUsdToEur(settings);
  return { currency: settings.displayCurrency, rates: { usdToRwf: settings.usdToRwf, usdToEur: eur.rate } };
}

/** The current admin's display currency and rates. Once per request. */
export const adminMoney = cache(async (): Promise<MoneyDisplay> => {
  const settings = await getSettings();
  const picked = (await cookies()).get(ADMIN_CURRENCY_COOKIE)?.value;
  const eur = await effectiveUsdToEur(settings);
  return { currency: isDisplayCurrency(picked) ? picked : settings.displayCurrency, rates: { usdToRwf: settings.usdToRwf, usdToEur: eur.rate } };
});

/**
 * The daily refresh (renewals job, and "Refresh now" in Settings): when it is switched on, the ECB rate from
 * api.frankfurter.app is stored. Any failure keeps the stored rates (logged); never throws.
 */
export async function refreshEurRate(opts: { force?: boolean; now?: Date; fetchImpl?: typeof fetch } = {}): Promise<{ ok: boolean; rate: number | null }> {
  const now = opts.now ?? new Date();
  const settings = await getSettings();
  if (!settings.eurRateAuto && !opts.force) return { ok: false, rate: null };
  try {
    const res = await (opts.fetchImpl ?? fetch)(FRANKFURTER_URL, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    const rate = res.ok ? parseFrankfurter(await res.json()) : null;
    if (!rate) throw new Error(`frankfurter answered ${res.status} without a usable EUR rate`);
    const value = { rate, fetchedAt: now.toISOString() } as Prisma.InputJsonValue;
    await prisma.adminSetting.upsert({ where: { key: EUR_LIVE_KEY }, create: { key: EUR_LIVE_KEY, value }, update: { value } });
    return { ok: true, rate };
  } catch (error) {
    await logError(error, { source: "money.eur_rate" });
    return { ok: false, rate: null };
  }
}
