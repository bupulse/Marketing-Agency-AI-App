import { requirePermission } from "@/lib/admin/auth";
import { ANNOUNCEMENT_STATES, AnnouncementsView, type AnnouncementState } from "@/components/admin/content-ai/announcements-view";
import { chosen } from "@/components/admin/kit";
import { nowMs, param } from "@/lib/admin/format";
import { listAnnouncements } from "@/lib/admin/service";
import { getPlans } from "@/lib/plan-catalog";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage({ searchParams }: PageProps<"/admin/announcements">) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [rows, allPlans] = await Promise.all([listAnnouncements(), getPlans()]);
  return (
    <AnnouncementsView
      rows={rows}
      plans={allPlans.map((p) => ({ key: p.key, name: p.name }))}
      now={nowMs()}
      show={chosen(sp, "show", ANNOUNCEMENT_STATES, "") as "" | AnnouncementState}
      params={sp}
      message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }}
    />
  );
}
