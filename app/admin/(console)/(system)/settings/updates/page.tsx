import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { getUpdateStatus } from "@/lib/admin/updates";
import { listReleases, isDryRun } from "@/lib/updates/releases";
import { resolvePublicKey } from "@/scripts/release-core.mjs";
import { RELEASE_PUBLIC_KEY } from "@/scripts/release-public-key.mjs";
import { UpdatesView } from "@/components/admin/system/updates-view";

export const metadata = { title: "Updates" };

export default async function UpdatesPage({ searchParams }: PageProps<"/admin/settings/updates">) {
  const me = await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [s, releases] = await Promise.all([getUpdateStatus(), listReleases().catch(() => [])]);
  // Uploading, installing and restoring a zip: the owner from ADMIN_EMAILS only (lib/updates/releases.ts).
  const isOwner = me.isOwner && !me.staffId;
  const signingKey = resolvePublicKey(RELEASE_PUBLIC_KEY, process.env.RELEASE_PUBLIC_KEY);
  return <UpdatesView s={s} releases={releases} isOwner={isOwner} signingKey={signingKey} dryRun={isDryRun()} ok={param(sp.notice)} bad={param(sp.error)} />;
}
