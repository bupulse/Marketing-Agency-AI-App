import { ExternalLink, Headset } from "lucide-react";
import { AgentsView } from "@/components/admin/live-chat/agents-view";
import { DepartmentsView } from "@/components/admin/live-chat/departments-view";
import { LiveChatHub } from "@/components/admin/live-chat/hub";
import { LeadsView } from "@/components/admin/live-chat/leads-view";
import { AiForm, GreetingsForm, HoursForm } from "@/components/admin/live-chat/settings-forms";
import { LIVE_CHAT_LOOK, LIVE_CHAT_TABS, LiveChatTabs, liveChatTab } from "@/components/admin/live-chat/tabs";
import { PageHeader } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { Button } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { chatLeads } from "@/lib/support/admin-leads";
import { listAgents, listDepartments, supportAppUrl } from "@/lib/support/agents";
import { getSupportSettings } from "@/lib/support/settings";
import {
  inviteAgentAction,
  renameDepartmentAction,
  resendAgentInviteAction,
  resetAgentAuthenticatorAction, answerJoinRequestAction,
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
  // No ?tab=: the hub (one card per part). Every action sends the admin back to its own ?tab=.
  const tab = param(sp.tab) ? liveChatTab(param(sp.tab)) : null;
  // Each part loads only what it shows (departments: also the agents tab, for names and the tick boxes); the hub
  // loads the small lists for its numbers.
  const after = param(sp.after) || null;
  const [agents, departments, settings, leads] = await Promise.all([
    tab === "agents" || !tab ? listAgents() : null,
    tab === "agents" || tab === "departments" || !tab ? listDepartments() : null,
    tab === "hours" || tab === "greetings" || tab === "ai" || !tab ? getSupportSettings() : null,
    tab === "leads" ? chatLeads({ after }) : !tab ? chatLeads() : null,
  ]);
  const label = tab ? LIVE_CHAT_TABS.find(([k]) => k === tab)![1] : "Live chat";
  return (
    <>
      <PageHeader
        icon={tab ? LIVE_CHAT_LOOK[tab].icon : Headset}
        tone="teal"
        title={label}
        description={tab ? LIVE_CHAT_LOOK[tab].hint : "BuPulse's own help chat. Support agents sign in at the support app with their own accounts, never admin ones."}
        back={tab ? { href: "/admin/live-chat", label: "Live chat" } : undefined}
        actions={<Button href={supportAppUrl()} variant="outline" size="sm" target="_blank" rel="noopener" trailing={<ExternalLink aria-hidden className="size-4" />}>Open the support app</Button>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {!tab && agents && departments && settings && leads && <LiveChatHub agents={agents} departments={departments} settings={settings} leads={{ count: leads.items.length, more: !!leads.next }} />}
      {tab && <LiveChatTabs current={tab} />}
      {tab === "agents" && agents && departments && (
        <AgentsView agents={agents} departments={departments} actions={{ invite: inviteAgentAction, update: updateAgentAction, setLocked: setAgentLockedAction, resend: resendAgentInviteAction, resetAuthenticator: resetAgentAuthenticatorAction, answerRequest: answerJoinRequestAction }} />
      )}
      {tab === "departments" && departments && <DepartmentsView departments={departments} rename={renameDepartmentAction} />}
      {tab === "hours" && settings && <HoursForm hours={settings.hours} save={saveHoursAction} />}
      {tab === "greetings" && settings && <GreetingsForm greetings={settings.greetings} save={saveGreetingsAction} />}
      {tab === "ai" && settings && <AiForm settings={settings} save={saveAiAction} />}
      {tab === "leads" && leads && <LeadsView leads={leads.items} next={leads.next} appUrl={supportAppUrl()} first={!after} />}
    </>
  );
}
