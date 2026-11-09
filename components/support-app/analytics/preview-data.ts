import type { VisitorAnalytics } from "@/lib/analytics/visitors";
import { addDays } from "@/lib/analytics/math";
import { dayMethod, funnelSteps, groupSeries, lastOldMethodDay, type VisitorPeriod } from "@/lib/analytics/visitors-shared";

// Made-up numbers for the dev-only preview (app/support/preview/analytics): the page's design without a database.
export function previewVisitorAnalytics(period: VisitorPeriod): VisitorAnalytics {
  const days = [];
  const switchDay = addDays(period.to, -9); // pretend the new counting started ten days ago
  for (let d = period.from, i = 0; d <= period.to; d = addDays(d, 1), i++) {
    const visitors = 20 + ((i * 37) % 23) + (i % 7 === 5 ? -8 : 0);
    const views = visitors * 3;
    days.push({ date: d, visitors, views, method: dayMethod(views, d < switchDay ? 0 : d === switchDay ? views / 2 : views) });
  }
  const visitors = days.reduce((s, d) => s + d.visitors, 0);
  return {
    range: { from: period.from, to: period.to },
    by: period.by,
    totals: { visitors, views: visitors * 3, avgMs: 48_200, visitorsWithCity: Math.round(visitors * 0.8), rawVisitors: visitors },
    series: groupSeries(days, period.from, period.to, period.by),
    lastOldDay: lastOldMethodDay(days),
    breakdownFrom: null,
    countries: [{ key: "RW", visitors: Math.round(visitors * 0.7), views: visitors * 2 }, { key: "UG", visitors: Math.round(visitors * 0.1), views: 40 }, { key: "KE", visitors: 12, views: 30 }, { key: "", visitors: 3, views: 5 }],
    cities: [{ city: "Kigali", country: "RW", visitors: Math.round(visitors * 0.55), views: visitors }, { city: "Musanze", country: "RW", visitors: 14, views: 33 }, { city: "Kampala", country: "UG", visitors: 9, views: 20 }],
    sources: [{ key: "direct", visitors: Math.round(visitors * 0.4), views: visitors }, { key: "google", visitors: Math.round(visitors * 0.3), views: 120 }, { key: "whatsapp", visitors: 40, views: 90 }, { key: "facebook", visitors: 22, views: 50 }, { key: "instagram", visitors: 15, views: 31 }, { key: "tiktok_oct", visitors: 4, views: 6 }],
    pages: [{ path: "/", views: 400, visitors: 300, avgMs: 35_000, timedViews: 380 }, { path: "/pricing", views: 220, visitors: 150, avgMs: 94_000, timedViews: 200 }, { path: "/quote", views: 60, visitors: 55, avgMs: 71_500, timedViews: 50 }, { path: "/blog/social-media-rwanda-small-business-guide", views: 30, visitors: 28, avgMs: null, timedViews: 0 }],
    funnel: funnelSteps({ visitors, quotes: 14, chats: 9, signups: 6, paid: 2 }),
    liveNow: 3,
  };
}
