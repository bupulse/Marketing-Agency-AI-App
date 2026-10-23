import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/app";
import { AgentsView } from "@/components/admin/live-chat/agents-view";
import { DepartmentsView } from "@/components/admin/live-chat/departments-view";
import { AiForm, GreetingsForm, HoursForm } from "@/components/admin/live-chat/settings-forms";
import { LiveChatTabs, liveChatTab } from "@/components/admin/live-chat/tabs";
import { notice } from "@/components/admin/ui";
import { Button } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listAgents, listDepartments, supportAppUrl } from "@/lib/support/agents";
import { getSupportSettings } from "@/lib/support/settings";
import {
  inviteAgentAction,
  renameDepartmentAction,
  resendAgentInviteAction,
  resetAgentAuthenticatorAction,
  saveAiAction,
  saveGreetingsAction,
  saveHoursAction,
  setAgentLockedAction,
  updateAgentAction,
} from "./actions";

export const metadata = { title: "Live chat" };

export default async function LiveChatPage({ searchParams }: PageProps<"/admin/live-chat">) {
  await requirePermission("liveChat"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const tab = liveChatTab(param(sp.tab));
  // Each tab loads only what it shows (departments: also the agents tab, for names and the checkboxes).
  const [agents, departments, settings] = await Promise.all([
    tab === "agents" ? listAgents() : null,
    tab === "agents" || tab === "departments" ? listDepartments() : null,
    tab === "hours" || tab === "greetings" || tab === "ai" ? getSupportSettings() : null,
  ]);
  return (
    <>
      <PageHeader
        title="Live chat"
        description="Support agents sign in at support.bupulse.com with their own accounts, never admin ones."
        action={<Button href={supportAppUrl()} variant="outline" size="sm" target="_blank" rel="noopener" trailing={<ExternalLink aria-hidden className="size-4" />}>Open the support app</Button>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <LiveChatTabs current={tab} />
      {agents && departments && (
        <AgentsView agents={agents} departments={departments} actions={{ invite: inviteAgentAction, update: updateAgentAction, setLocked: setAgentLockedAction, resend: resendAgentInviteAction, resetAuthenticator: resetAgentAuthenticatorAction }} />
      )}
      {tab === "departments" && departments && <DepartmentsView departments={departments} rename={renameDepartmentAction} />}
      {tab === "hours" && settings && <HoursForm hours={settings.hours} save={saveHoursAction} />}
      {tab === "greetings" && settings && <GreetingsForm greetings={settings.greetings} save={saveGreetingsAction} />}
      {tab === "ai" && settings && <AiForm settings={settings} save={saveAiAction} />}
    </>
  );
}
