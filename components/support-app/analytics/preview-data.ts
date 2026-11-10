import type { VisitorAnalytics } from "@/lib/analytics/visitors";
import { addDays } from "@/lib/analytics/math";
import { dayMethod, funnelSteps, groupSeries, lastOldMethodDay, previousRange, type VisitorPeriod } from "@/lib/analytics/visitors-shared";

// Made-up numbers for the dev-only preview (app/support/preview/analytics): the page's design without a database.
// Shaped like a small Rwandan site: mostly phones, mostly Rwanda, quieter on Sundays, slowly growing, with the odd
// busy day after a post did well. Deterministic (no Math.random), so screenshots match from run to run.

/** A steady pseudo-random number in [0, 1) for a day. */
function noise(day: string): number {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function visitorsOn(day: string): number {
  const t = (Date.parse(`${day}T00:00:00Z`) - Date.parse("2026-01-01T00:00:00Z")) / 86_400_000;
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const week = [0.62, 1.08, 1.12, 1.05, 1.1, 1.0, 0.78][dow]; // Sunday … Saturday
  const growth = 38 + t * 0.09;
  const spike = noise(`${day}!`) > 0.93 ? 1.7 : 1;
  return Math.round(growth * week * spike * (0.85 + noise(day) * 0.3));
}

export function previewVisitorAnalytics(period: VisitorPeriod): VisitorAnalytics {
  const days = [];
  const switchDay = addDays(period.to, -9); // pretend the new counting started ten days ago
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
    const visitors = visitorsOn(d);
    const views = Math.round(visitors * (2.6 + noise(`${d}v`) * 0.9));
    days.push({ date: d, visitors, views, method: dayMethod(views, d < switchDay ? 0 : d === switchDay ? views / 2 : views) });
  }
  const visitors = days.reduce((s, d) => s + d.visitors, 0);
  const views = days.reduce((s, d) => s + d.views, 0);
  const prev = previousRange(period.from, period.to);
  let prevVisitors = 0;
  let prevViews = 0;
  for (let d = prev.from; d <= prev.to; d = addDays(d, 1)) {
    const v = Math.round(visitorsOn(d) * 0.88);
    prevVisitors += v;
    prevViews += Math.round(v * 2.9);
  }
  const share = (p: number) => Math.max(1, Math.round(visitors * p));
  const shareViews = (p: number) => Math.max(1, Math.round(views * p));
  return {
    range: { from: period.from, to: period.to },
    by: period.by,
    totals: { visitors, views, avgMs: 52_400, visitorsWithCity: Math.round(visitors * 0.84), rawVisitors: visitors },
    series: groupSeries(days, period.from, period.to, period.by),
    lastOldDay: lastOldMethodDay(days),
    breakdownFrom: null,
    countries: [
      { key: "RW", visitors: share(0.71), views: shareViews(0.74) },
      { key: "UG", visitors: share(0.08), views: shareViews(0.07) },
      { key: "KE", visitors: share(0.06), views: shareViews(0.05) },
      { key: "US", visitors: share(0.04), views: shareViews(0.035) },
      { key: "BI", visitors: share(0.03), views: shareViews(0.03) },
      { key: "TZ", visitors: share(0.025), views: shareViews(0.02) },
      { key: "FR", visitors: share(0.015), views: shareViews(0.012) },
      { key: "CD", visitors: share(0.012), views: shareViews(0.01) },
      { key: "", visitors: share(0.008), views: shareViews(0.006) },
    ],
    cities: [
      { city: "Kigali", country: "RW", visitors: share(0.52), views: shareViews(0.55) },
      { city: "Musanze", country: "RW", visitors: share(0.06), views: shareViews(0.06) },
      { city: "Huye", country: "RW", visitors: share(0.05), views: shareViews(0.05) },
      { city: "Kampala", country: "UG", visitors: share(0.05), views: shareViews(0.045) },
      { city: "Rubavu", country: "RW", visitors: share(0.04), views: shareViews(0.035) },
      { city: "Nairobi", country: "KE", visitors: share(0.035), views: shareViews(0.03) },
      { city: "Bujumbura", country: "BI", visitors: share(0.02), views: shareViews(0.02) },
      { city: "Rwamagana", country: "RW", visitors: share(0.015), views: shareViews(0.012) },
    ],
    sources: [
      { key: "direct", visitors: share(0.31), views: shareViews(0.33) },
      { key: "google", visitors: share(0.22), views: shareViews(0.24) },
      { key: "whatsapp", visitors: share(0.16), views: shareViews(0.14) },
      { key: "instagram", visitors: share(0.12), views: shareViews(0.11) },
      { key: "facebook", visitors: share(0.08), views: shareViews(0.07) },
      { key: "tiktok", visitors: share(0.05), views: shareViews(0.045) },
      { key: "linkedin", visitors: share(0.03), views: shareViews(0.03) },
      { key: "chatgpt", visitors: share(0.02), views: shareViews(0.02) },
      { key: "kigalitoday.com", visitors: share(0.01), views: shareViews(0.01) },
    ],
    pages: [
      { path: "/", views: shareViews(0.34), visitors: share(0.62), avgMs: 38_000, timedViews: shareViews(0.32) },
      { path: "/pricing", views: shareViews(0.18), visitors: share(0.33), avgMs: 94_000, timedViews: shareViews(0.17) },
      { path: "/quote", views: shareViews(0.09), visitors: share(0.15), avgMs: 71_500, timedViews: shareViews(0.08) },
      { path: "/industries/restaurants", views: shareViews(0.07), visitors: share(0.1), avgMs: 63_000, timedViews: shareViews(0.06) },
      { path: "/signup", views: shareViews(0.06), visitors: share(0.08), avgMs: 45_000, timedViews: shareViews(0.05) },
      { path: "/blog/social-media-rwanda-small-business-guide", views: shareViews(0.05), visitors: share(0.07), avgMs: 182_000, timedViews: shareViews(0.04) },
      { path: "/industries/shops", views: shareViews(0.04), visitors: share(0.06), avgMs: 51_000, timedViews: shareViews(0.035) },
      { path: "/about", views: shareViews(0.03), visitors: share(0.05), avgMs: 29_000, timedViews: shareViews(0.025) },
      { path: "/contact", views: shareViews(0.02), visitors: share(0.03), avgMs: null, timedViews: 0 },
    ],
    funnel: funnelSteps({ visitors, quotes: share(0.024), chats: share(0.016), signups: share(0.011), paid: Math.max(1, Math.round(visitors * 0.0035)) }),
    devices: [
      { key: "mobile", visitors: share(0.78), views: shareViews(0.74) },
      { key: "desktop", visitors: share(0.19), views: shareViews(0.23) },
      { key: "tablet", visitors: share(0.03), views: shareViews(0.03) },
    ],
    previous: { from: prev.from, to: prev.to, visitors: prevVisitors, views: prevViews },
    liveNow: 3,
  };
}
