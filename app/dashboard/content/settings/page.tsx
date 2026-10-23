import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { ContentSettingsForm } from "@/components/content-board/settings-form";
import { prisma } from "@/lib/db";
import { getContentSettings } from "@/lib/content-board/settings-service";
import { isNetwork } from "@/lib/social/registry";
import { accountUsable } from "@/lib/publishing/service";
import { NETWORKS, type Network } from "@/lib/social/types";
import { askMessage, can } from "@/lib/team/roles";
import { DailyPostsForm } from "@/components/content-board/daily-posts-form";
import { getDailySettings } from "@/lib/daily-posts/settings-service";
import { hasFeature } from "@/lib/entitlements";
import { dailyPostAppsLimit, postsPerAppLimit } from "@/lib/plans";
import { aiPhotosAvailable } from "@/lib/visuals/service";

export const metadata = { title: "Post settings" };

export default async function ContentSettingsPage() {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, role, usage } = await getAppContext();
  const [settings, connections, daily] = await Promise.all([
    getContentSettings(business.id),
    prisma.connection.findMany({ where: { businessId: business.id, kind: "SOCIAL" }, select: { provider: true, status: true, postingMode: true } }),
    // Daily posts made for you (docs/CONTENT.md): only for plans that have them.
    hasFeature(business.id, "dailyPosts").then(async (on) => (on ? { settings: await getDailySettings(business.id), aiPhotos: await aiPhotosAvailable({ userId: business.userId, businessId: business.id }).catch(() => false) } : null)),
  ]);
  const connected = [...new Set(connections.map((c) => c.provider).filter(isNetwork))] as Network[];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/content" className="-mb-2 inline-flex min-h-11 w-fit items-center gap-1 px-1 text-[15px] font-medium text-muted hover:text-text">
        <ChevronLeft aria-hidden className="size-4" /> Posts
      </Link>
      <PageHeader title="Post settings" description="Choose which apps' posts wait for your approval, and the posts BuPulse makes for you each day." />
      {daily && (
        <DailyPostsForm
          initial={daily.settings}
          apps={NETWORKS}
          connected={[...new Set(connections.filter(accountUsable).map((c) => c.provider).filter(isNetwork))] as Network[]}
          perAppLimit={postsPerAppLimit(usage.limits)}
          appsLimit={dailyPostAppsLimit(usage.limits)}
          aiPhotos={daily.aiPhotos}
          canEdit={can(role, "contentSettings")}
          askText={askMessage("contentSettings")}
        />
      )}
      <ContentSettingsForm initial={settings} apps={NETWORKS} connected={connected} canEdit={can(role, "contentSettings")} askText={askMessage("contentSettings")} />
    </div>
  );
}
