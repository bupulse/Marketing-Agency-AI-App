import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ActivityFeed } from "@/components/admin/activity-feed";
import { Panel } from "@/components/admin/ui";
import { getActivity } from "@/lib/admin/activity";

export const metadata = { title: "Live activity" };

export default async function ActivityPage() {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const initial = await getActivity({ limit: 40 });
  return (
    <>
      <PageHeader title="Live activity" description="Sign-ups, onboarding, posts, leads, payments, refunds, plan changes, errors and every admin or Jarvis action, as they happen. Click a row to open the client." />
      <Panel title="Feed" description="Pause to read; filters narrow the list. It stops refreshing while this tab is hidden.">
        <ActivityFeed initial={initial} limit={40} />
      </Panel>
    </>
  );
}
