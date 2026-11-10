import { Activity } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/admin/kit";
import { ActivityFeed } from "@/components/admin/activity-feed";
import { Panel } from "@/components/admin/ui";
import { getActivity } from "@/lib/admin/activity";

export const metadata = { title: "Live activity" };

export default async function ActivityPage() {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const initial = await getActivity({ limit: 40 });
  return (
    <>
      <PageHeader icon={Activity} tone="slate" title="Live activity" description="What is happening right now: sign-ups, posts, leads, payments and every admin or Jarvis action. Tap a row to open the client." />
      <Panel title="Feed" description="Updates every few seconds. Pause to read; the filters narrow the list. It stops while this tab is hidden.">
        <ActivityFeed initial={initial} limit={40} />
      </Panel>
    </>
  );
}
