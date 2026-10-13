// Everything the Autopilot page shows, loaded for the signed-in user's business only.
import "server-only";
import { prisma } from "@/lib/db";
import { signPaths } from "@/lib/publishing/media";
import { accountUsable } from "@/lib/publishing/service";
import { getProvider, isNetwork } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import { createClient } from "@/lib/supabase/server";
import { loadVisuals, pickVisuals } from "@/lib/visuals/queries";
import { videoAvailable } from "@/lib/visuals/service";
import type { VisualView } from "@/lib/visuals/types";
import { getIdea, type Goal } from "./playbook";
import { readConfig, type AutopilotConfig } from "./settings";
import { localDateISO, nextWeekStart, safeZone, weekKey } from "./timezone";

export interface ViewAccount {
  id: string;
  network: Network;
  label: string;
  displayName: string;
  avatarUrl: string | null;
  usable: boolean;
}

export interface ViewPost {
  id: string;
  network: Network;
  label: string;
  format: string;
  title: string | null;
  text: string;
  hashtags: string[];
  scheduledAt: string | null;
  accountName: string;
  mediaUrls: string[];
  needsPicture: boolean;
}

export interface ViewCard {
  groupId: string;
  ideaName: string;
  goal: Goal | null;
  status: "PENDING_APPROVAL" | "SCHEDULED" | "DRAFT";
  posts: ViewPost[];
  /** The group's picture and video (docs/CONTENT_VISUALS.md); a pending video is made when the owner opens it. */
  image?: VisualView | null;
  video?: VisualView | null;
}

export interface ViewDay {
  /** "YYYY-MM-DD" in the business's time zone. */
  date: string;
  cards: ViewCard[];
}

export interface AutopilotView {
  config: AutopilotConfig;
  timeZone: string;
  accounts: ViewAccount[];
  /** The Monday the next run plans, as an ISO instant. */
  nextWeekStart: string;
  nextWeekPlanned: boolean;
  /** The most recent run: its note is shown to the owner. */
  latestRun: { status: string; postCount: number; note: string | null } | null;
  days: ViewDay[];
  pendingCount: number;
  photoCount: number;
  /** Whether the plan has video; without it video ideas keep their picture and script. */
  videoInPlan: boolean;
}

export async function loadAutopilotView(userId: string, now = new Date()): Promise<AutopilotView | null> {
  const business = await prisma.business.findUnique({ where: { userId }, include: { autopilot: true } });
  if (!business) return null;
  const timeZone = safeZone(business.timezone);
  const weekStart = nextWeekStart(now, timeZone);

  const [connections, run, latest, posts, photoCount] = await Promise.all([
    prisma.connection.findMany({ where: { businessId: business.id, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } }),
    prisma.autopilotRun.findUnique({ where: { businessId_weekStart: { businessId: business.id, weekStart: weekKey(weekStart, timeZone) } }, select: { status: true, postCount: true } }),
    prisma.autopilotRun.findFirst({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, select: { status: true, postCount: true, error: true, createdAt: true } }),
    prisma.post.findMany({
      where: {
        businessId: business.id,
        source: "AUTOPILOT",
        OR: [{ status: "PENDING_APPROVAL" }, { status: { in: ["SCHEDULED", "DRAFT"] }, scheduledAt: { gte: now } }],
      },
      orderBy: { scheduledAt: "asc" },
      take: 120,
      include: { connection: { select: { displayName: true } } },
    }),
    prisma.mediaAsset.count({ where: { businessId: business.id } }),
  ]);

  const accounts: ViewAccount[] = connections.flatMap((c) =>
    isNetwork(c.provider)
      ? [{ id: c.id, network: c.provider, label: getProvider(c.provider).rules.label, displayName: c.displayName ?? getProvider(c.provider).rules.label, avatarUrl: c.avatarUrl, usable: accountUsable(c) }]
      : [],
  );

  const urls = new Map<string, string>();
  const paths = [...new Set(posts.flatMap((p) => p.mediaPaths))].filter((p) => p.startsWith(`${userId}/`));
  if (paths.length > 0) {
    try {
      for (const [path, url] of await signPaths(await createClient(), paths, 60 * 60)) urls.set(path, url);
    } catch {
      // Pictures are a nicety; the plan still shows without them.
    }
  }

  const days = new Map<string, Map<string, ViewCard>>();
  for (const p of posts) {
    if (!isNetwork(p.network)) continue;
    const date = p.scheduledAt ? localDateISO(p.scheduledAt, timeZone) : localDateISO(now, timeZone);
    const idea = getIdea(p.playbookId);
    const key = p.groupId ?? p.id;
    const cards = days.get(date) ?? new Map<string, ViewCard>();
    const card = cards.get(key) ?? { groupId: key, ideaName: idea?.name ?? "Post", goal: idea?.goal ?? null, status: p.status as ViewCard["status"], posts: [] };
    card.posts.push({
      id: p.id,
      network: p.network,
      label: getProvider(p.network).rules.label,
      format: p.format,
      title: p.title,
      text: p.text,
      hashtags: p.hashtags,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      accountName: p.connection?.displayName ?? getProvider(p.network).rules.label,
      mediaUrls: p.mediaPaths.flatMap((m) => (urls.get(m) ? [urls.get(m)!] : [])),
      needsPicture: p.status === "DRAFT" && !!p.lastError,
    });
    if (p.status === "PENDING_APPROVAL") card.status = "PENDING_APPROVAL";
    cards.set(key, card);
    days.set(date, cards);
  }

  const groupIds = [...new Set(posts.flatMap((p) => (p.groupId ? [p.groupId] : [])))];
  const [visuals, videoInPlan] = await Promise.all([loadVisuals(business.id, { groupIds }).catch(() => []), videoAvailable(business.id)]);
  for (const cards of days.values()) for (const card of cards.values()) Object.assign(card, pickVisuals(visuals, { groupId: card.groupId }));

  return {
    videoInPlan,
    config: readConfig(business.autopilot),
    timeZone,
    accounts,
    nextWeekStart: weekStart.toISOString(),
    nextWeekPlanned: !!run && (run.status === "RUNNING" || run.postCount > 0 || run.status === "DONE"),
    latestRun: latest && now.getTime() - latest.createdAt.getTime() < 10 * 24 * 3600 * 1000 ? { status: latest.status, postCount: latest.postCount, note: latest.error } : null,
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cards]) => ({ date, cards: [...cards.values()] })),
    pendingCount: posts.filter((p) => p.status === "PENDING_APPROVAL").length,
    photoCount,
  };
}
