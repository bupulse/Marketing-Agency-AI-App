import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { TaskManager } from "@/components/creators/company/task-manager";
import { listTasks } from "@/lib/creators/campaigns";
import { dayIn } from "@/lib/creators/periods";

export const metadata = { title: "Campaign tasks" };

export default async function CampaignTasksPage({ params }: PageProps<"/dashboard/creators/[id]/tasks">) {
  const { id } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const tasks = await listTasks(actor, campaign.id);
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="tasks" />
      <TaskManager campaign={campaign} tasks={tasks} today={dayIn(new Date(), campaign.timezone)} />
    </div>
  );
}
