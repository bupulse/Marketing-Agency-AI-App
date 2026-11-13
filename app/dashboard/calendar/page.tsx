import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { Calendar } from "@/components/publishing/calendar";
import { loadCalendarPosts, loadComposerContext } from "@/lib/publishing/queries";
import { can } from "@/lib/team/roles";
import { dayKey } from "@/lib/publishing/time";

export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const blocked = await featureGate("calendar");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  const now = new Date();
  const [posts, context] = await Promise.all([loadCalendarPosts(business.id, now), loadComposerContext(business.id)]);

  return (
    <>
      <PageHeader icon={CalendarDays} tone="indigo" title="Calendar" description="What goes out each day. Drag a post to another day to move it." />
      <Calendar posts={posts} context={context} todayKey={dayKey(now, context.timezone)} nowIso={now.toISOString()} canSetZone={can(role, "settings")} />
    </>
  );
}
