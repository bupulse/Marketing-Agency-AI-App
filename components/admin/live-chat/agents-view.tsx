import { Badge, Button, buttonClasses, Field, Input, Select } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import type { AgentAdminView, DepartmentView } from "@/lib/support/agents";
import { ConfirmButton } from "../confirm-button";
import { Empty, Panel, TableWrap, Td, Th } from "../ui";

type Actions = {
  invite: (f: FormData) => Promise<void>;
  update: (f: FormData) => Promise<void>;
  setLocked: (f: FormData) => Promise<void>;
  resend: (f: FormData) => Promise<void>;
  resetAuthenticator: (f: FormData) => Promise<void>;
};

const STATUS_TONE = { active: "success", invited: "violet", locked: "danger" } as const;
const ROLE_LABEL: Record<string, string> = { AGENT: "Agent", SUPERVISOR: "Supervisor" };
const ROLE_OPTIONS = [
  ["AGENT", "Agent: replies to chats"],
  ["SUPERVISOR", "Supervisor: sees all chats and stats"],
] as const;

/** Signed in at least once (so there is an authenticator to reset): active, a verified app, or seen in the app. */
export const hasSignedIn = (a: Pick<AgentAdminView, "status" | "authenticator" | "lastSeenAt">) => a.status === "active" || a.authenticator === true || a.lastSeenAt !== null;

function CodeCell({ agent }: { agent: AgentAdminView }) {
  if (agent.authenticator) return <span className="font-semibold text-success">On</span>;
  if (agent.status === "invited") return <span className="font-semibold text-new">Invite sent</span>;
  if (agent.authenticator === null) return <span className="text-muted">Could not check</span>;
  return <span className="text-muted">Not set up</span>;
}

function DepartmentBoxes({ departments, checked }: { departments: DepartmentView[]; checked: readonly string[] }) {
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-1 text-[13px] font-semibold">Departments</legend>
      {departments.map((d) => (
        <label key={d.key} className="flex min-h-11 items-center gap-3 text-[14px]">
          <input type="checkbox" name="departments" value={d.key} defaultChecked={checked.includes(d.key)} className="size-5" />
          <span>{d.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

function RoleSelect({ value }: { value: string }) {
  return (
    <Select name="role" defaultValue={value} required>
      {ROLE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </Select>
  );
}

function EditAgent({ agent, departments, action }: { agent: AgentAdminView; departments: DepartmentView[]; action: Actions["update"] }) {
  return (
    <details className="text-left">
      <summary className={cn(buttonClasses({ variant: "outline", size: "sm" }), "list-none [&::-webkit-details-marker]:hidden")} aria-label={`Edit ${agent.name}`}>Edit</summary>
      <form action={action} className="mt-3 flex w-72 max-w-[80vw] flex-col gap-3 rounded-2xl bg-soft p-4">
        <input type="hidden" name="id" value={agent.id} />
        <Field label="Name" required><Input name="name" defaultValue={agent.name} minLength={2} maxLength={80} /></Field>
        <Field label="Role" required><RoleSelect value={agent.role} /></Field>
        <DepartmentBoxes departments={departments} checked={agent.departments} />
        <Field label="Chats at once" hint="1 to 20. New chats wait when they are full."><Input name="maxChats" type="number" min={1} max={20} step={1} defaultValue={agent.maxChats} /></Field>
        <Button type="submit" size="sm">Save</Button>
      </form>
    </details>
  );
}

function AgentRow({ agent, departments, actions }: { agent: AgentAdminView; departments: DepartmentView[]; actions: Actions }) {
  const names = departments.filter((d) => agent.departments.includes(d.key)).map((d) => d.name);
  return (
    <tr>
      <Td className="max-w-[16rem]"><span className="block truncate font-medium">{agent.name}</span><span className="block truncate text-xs text-muted">{agent.email}</span></Td>
      <Td>{ROLE_LABEL[agent.role] ?? agent.role}</Td>
      <Td>{names.length ? names.join(", ") : agent.role === "SUPERVISOR" ? "All" : <span className="text-muted">None</span>}</Td>
      <Td className="whitespace-nowrap"><CodeCell agent={agent} /></Td>
      <Td><Badge tone={STATUS_TONE[agent.status as keyof typeof STATUS_TONE] ?? "neutral"}>{agent.status}</Badge></Td>
      <Td className="whitespace-nowrap">{agent.lastSeenAt ? dateTime(agent.lastSeenAt) : <span className="text-muted">Never</span>}</Td>
      <Td right>
        <span className="flex flex-wrap items-start justify-end gap-2">
          <EditAgent agent={agent} departments={departments} action={actions.update} />
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
        </span>
      </Td>
    </tr>
  );
}

/** Support agents (their own sign-ins at the support app) and the "Add an agent" form. */
export function AgentsView({ agents, departments, actions }: { agents: AgentAdminView[]; departments: DepartmentView[]; actions: Actions }) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel title={`Agents (${agents.length})`} description="A locked agent is signed out at once. Supervisors see every chat; agents get the chats of their departments.">
        {agents.length === 0 ? (
          <Empty>No support agents yet. Add your first one with the form.</Empty>
        ) : (
          <TableWrap caption="Support agents">
            <thead><tr><Th>Agent</Th><Th>Role</Th><Th>Departments</Th><Th>6-digit code</Th><Th>Status</Th><Th>Last sign-in</Th><Th right><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {agents.map((a) => <AgentRow key={a.id} agent={a} departments={departments} actions={actions} />)}
            </tbody>
          </TableWrap>
        )}
      </Panel>
      <Panel title="Add an agent">
        <form action={actions.invite} className="flex flex-col gap-3">
          <Field label="Name" required><Input name="name" minLength={2} maxLength={80} placeholder="Full name" autoComplete="off" /></Field>
          <Field label="Work email" required><Input name="email" type="email" maxLength={254} placeholder="name@example.com" autoComplete="off" /></Field>
          <Field label="Role" required><RoleSelect value="AGENT" /></Field>
          <DepartmentBoxes departments={departments} checked={[departments[0]?.key ?? "sales"]} />
          <Button type="submit">Send invite</Button>
          <p className="text-xs text-muted">They get an email to set a password and an authenticator code. You can lock an agent out at any time.</p>
        </form>
      </Panel>
    </div>
  );
}
