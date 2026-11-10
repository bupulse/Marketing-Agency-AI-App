import { UserPlus } from "lucide-react";
import { Button, buttonClasses, Field, Input } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import type { AgentAdminView, DepartmentView } from "@/lib/support/agents";
import { ConfirmButton } from "../confirm-button";
import { CARD, EmptyState, ExpandCard, StatusPill, type PillTone } from "../kit";
import { FormChips } from "../kit/form-chips";

type Actions = {
  invite: (f: FormData) => Promise<void>;
  update: (f: FormData) => Promise<void>;
  setLocked: (f: FormData) => Promise<void>;
  resend: (f: FormData) => Promise<void>;
  resetAuthenticator: (f: FormData) => Promise<void>;
  answerRequest: (f: FormData) => Promise<void>;
};

const STATUS: Record<string, { tone: PillTone; label: string }> = {
  active: { tone: "good", label: "Active" },
  invited: { tone: "new", label: "Invited" },
  locked: { tone: "bad", label: "Locked" },
  pending: { tone: "warn", label: "Asks to join" },
};
const ROLE_LABEL: Record<string, string> = { AGENT: "Agent", SUPERVISOR: "Supervisor", TECH: "Technical" };
const ROLE_OPTIONS = [
  { value: "AGENT", label: "Agent", hint: "Replies to chats" },
  { value: "SUPERVISOR", label: "Supervisor", hint: "Sees all chats and stats" },
  { value: "TECH", label: "Technical", hint: "Replies to chats and watches the servers" },
];

/** Signed in at least once (so there is an authenticator to reset): active, a verified app, or seen in the app. */
export const hasSignedIn = (a: Pick<AgentAdminView, "status" | "authenticator" | "lastSeenAt">) => a.status === "active" || a.authenticator === true || a.lastSeenAt !== null;

function CodeState({ agent }: { agent: AgentAdminView }) {
  if (agent.authenticator) return <span className="font-semibold text-success">On</span>;
  if (agent.status === "invited") return <span className="font-semibold text-new">Invite sent</span>;
  if (agent.authenticator === null) return <span className="text-muted">Could not check</span>;
  return <span className="text-muted">Not set up</span>;
}

const departmentChips = (departments: DepartmentView[]) => departments.map((d) => ({ value: d.key, label: d.name }));

function EditAgent({ agent, departments, action }: { agent: AgentAdminView; departments: DepartmentView[]; action: Actions["update"] }) {
  return (
    <details className="group/edit w-full">
      <summary className={cn(buttonClasses({ variant: "outline", size: "sm" }), "w-fit list-none [&::-webkit-details-marker]:hidden")} aria-label={`Edit ${agent.name}`}>Edit</summary>
      <form action={action} className="mt-3 flex flex-col gap-4 rounded-2xl bg-soft p-4 dark:bg-white/[0.04]">
        <input type="hidden" name="id" value={agent.id} />
        <Field label="Name" required><Input name="name" defaultValue={agent.name} minLength={2} maxLength={80} /></Field>
        <FormChips name="role" legend="Role" options={ROLE_OPTIONS} defaultValue={agent.role} required tiles />
        <FormChips name="departments" legend="Departments" options={departmentChips(departments)} defaultValue={agent.departments} multiple />
        <Field label="Chats at once" hint="1 to 20. New chats wait when they are full."><Input name="maxChats" type="number" min={1} max={20} step={1} defaultValue={agent.maxChats} className="max-w-32" /></Field>
        <Button type="submit" size="sm" className="self-start">Save</Button>
      </form>
    </details>
  );
}

function AgentCard({ agent, departments, actions }: { agent: AgentAdminView; departments: DepartmentView[]; actions: Actions }) {
  const names = departments.filter((d) => agent.departments.includes(d.key)).map((d) => d.name);
  const status = STATUS[agent.status] ?? { tone: "muted" as PillTone, label: agent.status };
  return (
    <li data-agent={agent.id} className={cn("flex min-w-0 flex-col gap-3 p-4 sm:p-5", CARD, agent.status === "pending" && "ring-1 ring-[#f59e0b]/40")}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0e7490,#22d3ee)] text-[16px] font-bold text-white">{agent.name.trim().charAt(0).toUpperCase() || "?"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{agent.name}</p>
          <p className="truncate text-[13px] text-muted">{agent.email}</p>
        </div>
        <StatusPill tone={status.tone} dot>{status.label}</StatusPill>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
        <div className="min-w-0"><dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Role</dt><dd>{ROLE_LABEL[agent.role] ?? agent.role}</dd></div>
        <div className="min-w-0"><dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Departments</dt><dd className="break-words">{names.length ? names.join(", ") : agent.role === "SUPERVISOR" ? "All" : <span className="text-muted">None</span>}</dd></div>
        <div className="min-w-0"><dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">6-digit code</dt><dd><CodeState agent={agent} /></dd></div>
        <div className="min-w-0"><dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Last sign-in</dt><dd>{agent.lastSeenAt ? dateTime(agent.lastSeenAt) : <span className="text-muted">Never</span>}</dd></div>
      </dl>
      <div className="flex flex-wrap items-start gap-2 border-t border-line pt-3">
        {agent.status === "pending" ? (
          // Asked to join on the support app (docs/SUPPORT_DASHBOARD.md): approving sends the usual invite.
          <>
            <form action={actions.answerRequest}><input type="hidden" name="id" value={agent.id} /><input type="hidden" name="answer" value="approve" /><Button type="submit" size="sm">Approve</Button></form>
            <ConfirmButton action={actions.answerRequest} fields={{ id: agent.id, answer: "decline" }} label="Decline" title={`Decline ${agent.name}'s request?`} description="The request is removed. They can ask again later." confirmLabel="Decline" />
          </>
        ) : (
          <>
            {agent.status === "invited" && (
              <form action={actions.resend}><input type="hidden" name="id" value={agent.id} /><Button type="submit" size="sm" variant="outline">Resend invite</Button></form>
            )}
            {agent.status === "locked" ? (
              <ConfirmButton action={actions.setLocked} fields={{ id: agent.id, locked: "0" }} label="Unlock" title={`Unlock ${agent.name}?`} description="They can sign in again with their password and 6-digit code." confirmLabel="Unlock" />
            ) : (
              <ConfirmButton action={actions.setLocked} fields={{ id: agent.id, locked: "1" }} label="Lock" title={`Lock ${agent.name}?`} description="They are signed out at once and cannot sign in until unlocked." confirmLabel="Lock" />
            )}
            {hasSignedIn(agent) && (
              <ConfirmButton action={actions.resetAuthenticator} fields={{ id: agent.id }} label="Reset authenticator" title={`Reset ${agent.name}'s authenticator?`} description="Their authenticator app is removed and they are signed out. At their next sign-in they add one again." confirmLabel="Reset" />
            )}
            <EditAgent agent={agent} departments={departments} action={actions.update} />
          </>
        )}
      </div>
    </li>
  );
}

/** Support agents (their own sign-ins at the support app) as cards, people asking to join first, and "Add an agent". */
export function AgentsView({ agents, departments, actions }: { agents: AgentAdminView[]; departments: DepartmentView[]; actions: Actions }) {
  const sorted = [...agents].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
  return (
    <div className="flex flex-col gap-4">
      <ExpandCard icon={UserPlus} tone="teal" title="Add an agent" summary="They get an email to set a password and an authenticator code." defaultOpen={agents.length === 0}>
        <form action={actions.invite} className="flex max-w-2xl flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required><Input name="name" minLength={2} maxLength={80} placeholder="Full name" autoComplete="off" /></Field>
            <Field label="Work email" required><Input name="email" type="email" maxLength={254} placeholder="name@example.com" autoComplete="off" /></Field>
          </div>
          <FormChips name="role" legend="Role" options={ROLE_OPTIONS} defaultValue="AGENT" required tiles />
          <FormChips name="departments" legend="Departments" options={departmentChips(departments)} defaultValue={[departments[0]?.key ?? "sales"]} multiple />
          <Button type="submit" className="self-start">Send invite</Button>
          <p className="text-xs text-muted">You can lock an agent out at any time.</p>
        </form>
      </ExpandCard>
      <div className="flex flex-col gap-1 px-1">
        <h2 className="text-[17px] font-bold tracking-[-0.02em]">Agents ({agents.length})</h2>
        <p className="text-[13px] text-muted">A locked agent is signed out at once. Supervisors see every chat; agents get the chats of their departments.</p>
      </div>
      {agents.length === 0 ? (
        <EmptyState title="No support agents yet." hint="Add your first one with the card above." />
      ) : (
        <ul aria-label="Support agents" className="kit-rise grid items-start gap-3 lg:grid-cols-2">
          {sorted.map((a) => <AgentCard key={a.id} agent={a} departments={departments} actions={actions} />)}
        </ul>
      )}
    </div>
  );
}
