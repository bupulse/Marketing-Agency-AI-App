"use client";

import { useActionState, useState, type FormEvent, type ReactNode } from "react";
import { Check, Clock, Headphones, Inbox, Lock, Mail, ShieldCheck, UserCheck, UserPlus, Users, Wrench, X } from "lucide-react";
import { answerRequest, type TeamActionState } from "@/app/support/(app)/team/actions";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/support/app-client/lists";
import { kigaliTime } from "@/lib/monitor/uptime-rules";
import { filterTeam, teamCounts, type TeamRoleFilter, type TeamStatusFilter } from "./team/team-filters";
import { AddMemberCard, ManageMember } from "./team/account-forms";

// The Team page (admin@bupulse.com only): requests to join as cards with Approve / Decline, then the team as cards
// with chip filters by status and role. Approve / Decline use the same server action as before (team/actions.ts).

type Request = { id: string; name: string; email: string; role: string; createdAt: string };
type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  availability: string;
  lastSeenAt: string | null;
  /** Has a sign-in (an invite opened, or an account made with a password). */
  hasSignIn?: boolean;
  /** Has added an authenticator app; null when it could not be read. */
  authenticator?: boolean | null;
  /** The admin may set a password or ask for a new authenticator (not admin@bupulse.com itself). */
  manageable?: boolean;
};

const ROLE: Record<string, { label: string; hint: string; icon: typeof Headphones; pill: string }> = {
  AGENT: { label: "Chat agent", hint: "Answers chats", icon: Headphones, pill: "bg-ok-bg text-ok" },
  TECH: { label: "Technical support", hint: "Chats and the servers", icon: Wrench, pill: "bg-new-bg text-new" },
  SUPERVISOR: { label: "Supervisor", hint: "Everything, all chats, stats", icon: ShieldCheck, pill: "bg-success-bg text-success" },
};
const STATUS: Record<string, { label: string; pill: string; icon: typeof Check }> = {
  active: { label: "Active", pill: "bg-success-bg text-success", icon: UserCheck },
  invited: { label: "Not signed in yet", pill: "bg-[#fff4e0] text-[#b45309] dark:bg-[#3a2a0a] dark:text-[#ffc65c]", icon: Mail },
  locked: { label: "Locked", pill: "bg-danger-bg text-danger", icon: Lock },
};
const AVAILABILITY: Record<string, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-[#0ca30c]" },
  away: { label: "Away", dot: "bg-[#fab219]" },
  offline: { label: "Offline", dot: "bg-[#9a9aa0]" },
};
const when = (iso: string | null) => (iso ? kigaliTime(new Date(iso)) : "Never");

const CSS = `
@keyframes team-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.team-rise > * { animation: team-rise .45s cubic-bezier(.2,.8,.2,1) both }
.team-rise > *:nth-child(2) { animation-delay: .05s } .team-rise > *:nth-child(3) { animation-delay: .1s }
.team-rise > *:nth-child(4) { animation-delay: .15s } .team-rise > *:nth-child(n+5) { animation-delay: .2s }
@media (prefers-reduced-motion: reduce) { .team-rise > * { animation: none !important } }
`;

function Pill({ className, icon, children }: { className: string; icon?: ReactNode; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", className)}>{icon}{children}</span>;
}

function RolePill({ role }: { role: string }) {
  const r = ROLE[role];
  if (!r) return <Pill className="bg-soft text-muted">{role}</Pill>;
  return <Pill className={r.pill} icon={<r.icon aria-hidden className="size-3.5" />}>{r.label}</Pill>;
}

function Avatar({ name, availability, size = "md" }: { name: string; availability?: string; size?: "md" | "lg" }) {
  const a = availability ? (AVAILABILITY[availability] ?? AVAILABILITY.offline) : null;
  return (
    <span className="relative inline-flex shrink-0">
      <span aria-hidden className={cn("inline-flex items-center justify-center rounded-full bg-brand-gradient font-bold text-white shadow-[0_8px_18px_-10px_rgba(47,107,255,0.9)]", size === "lg" ? "size-12 text-[15px]" : "size-11 text-[14px]")}>
        {initials(name)}
      </span>
      {a && <span aria-hidden className={cn("absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-[var(--bp-bg-solid)]", a.dot)} />}
    </span>
  );
}

function RequestCard({ r, preview }: { r: Request; preview: boolean }) {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(answerRequest, {});
  const [fake, setFake] = useState<TeamActionState>({});
  const shown = preview ? fake : state;
  const onPreviewSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    setFake({ done: submitter?.value === "approve" ? `${r.name} is approved: the invite email is on its way (preview only).` : `${r.name}'s request was declined (preview only).` });
  };
  return (
    <li className="relative flex flex-col gap-3 overflow-hidden rounded-[20px] border border-line bg-surface p-4 shadow-[0_18px_44px_-34px_rgba(17,24,39,0.5)]">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
      <div className="flex items-start gap-3">
        <Avatar name={r.name} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[15px] font-bold">{r.name}</p>
          <p className="truncate text-[13px] text-muted">{r.email}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <RolePill role={r.role} />
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <Clock aria-hidden className="size-3.5" /> Asked {when(r.createdAt)}
            </span>
          </div>
        </div>
      </div>
      {shown.error && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-[13px] text-danger">{shown.error}</p>}
      {shown.done ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-success-bg px-3 py-2 text-[13px] text-success">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> {shown.done}
        </p>
      ) : (
        <form action={preview ? undefined : action} onSubmit={preview ? onPreviewSubmit : undefined} className="grid grid-cols-2 gap-2">
          <input type="hidden" name="id" value={r.id} />
          <button
            type="submit"
            name="answer"
            value="approve"
            disabled={pending}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-brand-gradient px-3 text-sm font-semibold text-white shadow-[0_10px_22px_-12px_rgba(47,107,255,0.9)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 disabled:opacity-60 motion-reduce:transform-none"
          >
            <Check aria-hidden className="size-4" strokeWidth={3} /> Approve
          </button>
          <button
            type="submit"
            name="answer"
            value="decline"
            disabled={pending}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold transition-colors hover:border-danger/40 hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 disabled:opacity-60"
          >
            <X aria-hidden className="size-4" strokeWidth={3} /> Decline
          </button>
        </form>
      )}
    </li>
  );
}

function MemberCard({ m, preview }: { m: Member; preview: boolean }) {
  const s = STATUS[m.status];
  const a = AVAILABILITY[m.availability] ?? AVAILABILITY.offline;
  const active = m.status === "active";
  return (
    <li className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-26px_rgba(17,24,39,0.5)] motion-reduce:transform-none">
      <div className="flex items-start gap-3">
        <Avatar name={m.name} availability={active ? m.availability : undefined} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-[15px] font-bold">{m.name}</p>
          <p className="truncate text-[13px] text-muted">{m.email}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <RolePill role={m.role} />
        {s ? <Pill className={s.pill} icon={<s.icon aria-hidden className="size-3.5" />}>{s.label}</Pill> : <Pill className="bg-soft text-muted">{m.status}</Pill>}
        {m.hasSignIn && m.authenticator === true && <Pill className="bg-success-bg text-success" icon={<ShieldCheck aria-hidden className="size-3.5" />}>Authenticator added</Pill>}
        {m.hasSignIn && m.authenticator === false && <Pill className="bg-[#fff4e0] text-[#b45309] dark:bg-[#3a2a0a] dark:text-[#ffc65c]" icon={<ShieldCheck aria-hidden className="size-3.5" />}>Needs an authenticator</Pill>}
      </div>
      {m.manageable && <ManageMember id={m.id} name={m.name} authenticator={m.authenticator ?? null} preview={preview} />}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5 text-[12.5px] text-muted">
        <span className="flex items-center gap-1.5">
          {active ? (
            <>
              <span aria-hidden className={cn("size-2 rounded-full", a.dot)} />
              <span className="font-semibold text-text">{a.label}</span>
            </>
          ) : (
            <span>Not signed in yet</span>
          )}
        </span>
        <span>Last seen {when(m.lastSeenAt)}</span>
      </div>
    </li>
  );
}

function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count: number }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 text-[13px] font-semibold transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transform-none motion-reduce:transition-none",
        on ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:border-pulse-blue/40",
      )}
    >
      {on && <Check aria-hidden className="size-3.5 text-pulse-blue" strokeWidth={3} />}
      {children}
      <span className={cn("rounded-full px-1.5 text-[11.5px] tabular-nums", on ? "bg-pulse-blue text-white" : "bg-soft")}>{count}</span>
    </button>
  );
}

function Tile({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface p-3">
      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">{icon}{label}</span>
      <span className="text-[24px] font-bold leading-none tabular-nums tracking-[-0.02em]">{value}</span>
      <span className="text-[11.5px] leading-snug text-muted">{hint}</span>
    </div>
  );
}

/** Requests to join first (they need an answer), then the whole team. */
export function TeamView({ requests, team, preview = false, signInUrl = "https://support.bupulse.com/sign-in" }: { requests: Request[]; team: Member[]; preview?: boolean; signInUrl?: string }) {
  const [status, setStatus] = useState<TeamStatusFilter>("all");
  const [role, setRole] = useState<TeamRoleFilter>("all");
  const counts = teamCounts(team, status, role);
  const shown = filterTeam(team, status, role);
  const statusChips: [TeamStatusFilter, string][] = [["all", "All"], ["active", "Active"], ["invited", "Invited"], ["locked", "Locked"]];
  const roleChips: [TeamRoleFilter, string][] = [["all", "All roles"], ["AGENT", "Chat agents"], ["TECH", "Technical support"], ["SUPERVISOR", "Supervisors"]];
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 p-4 sm:p-6">
      <style href="bp-support-team" precedence="default">{CSS}</style>
      <section className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_24px_-12px_rgba(47,107,255,0.9)]">
            <Users className="size-5" />
          </span>
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em]">Team</h1>
            <p className="mt-0.5 text-sm text-muted">
              Add someone with a password (no email needed), or approve people who asked to join. Everyone must add an authenticator app before they can open anything. Edit departments or lock someone in Admin → Live chat.
            </p>
          </div>
        </div>
        <div className="team-rise grid grid-cols-3 gap-2 sm:gap-3">
          <Tile icon={<Inbox aria-hidden className="size-3.5" />} label="Waiting" value={requests.length} hint="Asked to join, need your answer" />
          <Tile icon={<UserCheck aria-hidden className="size-3.5" />} label="Active" value={team.filter((m) => m.status === "active").length} hint="Can sign in and answer chats" />
          <Tile icon={<span aria-hidden className="size-2 rounded-full bg-[#0ca30c]" />} label="Online now" value={counts.online} hint="Set to Online right now" />
        </div>
      </section>

      <AddMemberCard signInUrl={signInUrl} preview={preview} />

      <section aria-labelledby="requests" className="flex flex-col gap-3">
        <h2 id="requests" className="flex items-center gap-2 text-[17px] font-bold">
          <UserPlus aria-hidden className="size-5 text-pulse-blue" /> Waiting for approval
          <span className="rounded-full bg-soft px-2 text-[13px] tabular-nums">{requests.length}</span>
        </h2>
        {requests.length === 0 ? (
          <p className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-muted">
            <Check aria-hidden className="size-4 text-success" /> No requests right now. New ones show up here.
          </p>
        ) : (
          <ul className="team-rise grid gap-3 md:grid-cols-2">
            {requests.map((r) => (
              <RequestCard key={r.id} r={r} preview={preview} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="members" className="flex flex-col gap-3">
        <h2 id="members" className="flex items-center gap-2 text-[17px] font-bold">
          <Users aria-hidden className="size-5 text-pulse-blue" /> Support team
          <span className="rounded-full bg-soft px-2 text-[13px] tabular-nums">{team.length}</span>
        </h2>
        <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Show by status" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {statusChips.map(([v, label]) => (
              <Chip key={v} on={status === v} onClick={() => setStatus(v)} count={counts.status[v]}>
                {label}
              </Chip>
            ))}
          </div>
          <div role="radiogroup" aria-label="Show by role" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {roleChips.map(([v, label]) => (
              <Chip key={v} on={role === v} onClick={() => setRole(v)} count={counts.role[v]}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Nobody matches these filters. Tap All to see everyone.</p>
        ) : (
          <ul key={`${status}:${role}`} className="team-rise grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((m) => (
              <MemberCard key={m.id} m={m} preview={preview} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
