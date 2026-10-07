import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Calendar } from "@/components/publishing/calendar";
import { loadCalendarPosts, loadComposerContext } from "@/lib/publishing/queries";
import { dayKey } from "@/lib/publishing/time";

export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const { business } = await getAppContext();
  const now = new Date();
  const [posts, context] = await Promise.all([loadCalendarPosts(business.id, now), loadComposerContext(business.id)]);

  return (
    <>
      <PageHeader title="Calendar" description="See what is planned, what is live and what needs attention." />
      <Calendar posts={posts} context={context} todayKey={dayKey(now, context.timezone)} nowIso={now.toISOString()} />
    </>
  );
}
