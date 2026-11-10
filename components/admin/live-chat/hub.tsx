import { UserPlus } from "lucide-react";
import type { AgentAdminView, DepartmentView } from "@/lib/support/agents";
import type { SupportSettings } from "@/lib/support/settings";
import { SectionCard, SectionGrid, TodoList, type TodoItem } from "../kit";
import { agentCounts, hoursSummary } from "./summary";
import { LIVE_CHAT_LOOK, LIVE_CHAT_TABS, type LiveChatTab } from "./tabs";

const href = (tab: LiveChatTab) => `/admin/live-chat?tab=${tab}`;

/**
 * The Live chat home: join requests to answer first (when there are any), then one card per part (agents,
 * departments, hours, greetings, AI rules, chat leads), each with the one number or line that matters.
 */
export function LiveChatHub({ agents, departments, settings, leads }: { agents: AgentAdminView[]; departments: DepartmentView[]; settings: SupportSettings; leads: { count: number; more: boolean } }) {
  const n = agentCounts(agents);
  const openDays = Object.values(settings.hours).filter((r) => r.length > 0).length;
  const todos: TodoItem[] = [];
  if (n.pending > 0) todos.push({ key: "pending", href: href("agents"), icon: UserPlus, tone: "warn", count: n.pending, text: `${n.pending} ${n.pending === 1 ? "person asked" : "people asked"} to join the support team`, sub: "Approve to send their invite, or decline." });
  const figure: Record<LiveChatTab, { value?: string; valueLabel?: string; count?: number; countLabel?: string }> = {
    agents: { value: String(n.active), valueLabel: `active${n.invited ? ` · ${n.invited} invited` : ""}${n.locked ? ` · ${n.locked} locked` : ""}`, count: n.pending, countLabel: `${n.pending} waiting for approval` },
    departments: { value: String(departments.length), valueLabel: departments.map((d) => d.name).join(", ") },
    hours: { value: `${openDays} ${openDays === 1 ? "day" : "days"}`, valueLabel: hoursSummary(settings.hours) },
    greetings: { value: String(settings.greetings.length), valueLabel: settings.greetings.length === 1 ? "greeting" : "greetings" },
    ai: { value: settings.aiEnabled ? "On" : "Off", valueLabel: settings.aiEnabled ? "The AI answers first" : "Every chat waits for a person" },
    leads: { value: leads.more ? `${leads.count}+` : String(leads.count), valueLabel: leads.count === 1 ? "lead" : "leads" },
  };
  return (
    <>
      {todos.length > 0 && <TodoList items={todos} />}
      <SectionGrid>
        {LIVE_CHAT_TABS.map(([key, label]) => (
          <SectionCard key={key} href={href(key)} icon={LIVE_CHAT_LOOK[key].icon} tone="teal" title={label} hint={LIVE_CHAT_LOOK[key].hint} value={figure[key].value} valueLabel={figure[key].valueLabel} count={figure[key].count} countLabel={figure[key].countLabel} row />
        ))}
      </SectionGrid>
    </>
  );
}
