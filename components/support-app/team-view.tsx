"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { answerRequest, type TeamActionState } from "@/app/support/(app)/team/actions";

type Request = { id: string; name: string; email: string; role: string; createdAt: string };
type Member = { id: string; name: string; email: string; role: string; status: string; availability: string; lastSeenAt: string | null };

const ROLE: Record<string, string> = { AGENT: "Chat agent", TECH: "Technical support", SUPERVISOR: "Supervisor" };
const STATUS: Record<string, string> = { active: "Active", invited: "Invite sent", locked: "Locked" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Never");

function RequestRow({ r }: { r: Request }) {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(answerRequest, {});
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold">{r.name}</p>
        <p className="truncate text-sm text-muted">{r.email}</p>
        <p className="text-sm">
          {ROLE[r.role] ?? r.role} · asked {when(r.createdAt)}
        </p>
        {state.error && <p role="alert" className="mt-1 text-sm text-danger">{state.error}</p>}
        {state.done && <p role="status" className="mt-1 text-sm text-ok">{state.done}</p>}
      </div>
      {!state.done && (
        <form action={action} className="flex gap-2">
          <input type="hidden" name="id" value={r.id} />
          <Button type="submit" name="answer" value="approve" size="sm" disabled={pending}>Approve</Button>
          <Button type="submit" name="answer" value="decline" size="sm" variant="outline" disabled={pending}>Decline</Button>
        </form>
      )}
    </li>
  );
}

/** Requests to join first (they need an answer), then the whole team. */
export function TeamView({ requests, team }: { requests: Request[]; team: Member[] }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 sm:p-6">
      <section>
        <h1 className="text-xl font-bold">Team</h1>
        <p className="mt-1 text-sm text-muted">
          People ask to join on the sign-in page (Ask to join). Approving sends them an email to choose a password and add an
          authenticator app. Edit roles, lock someone or reset an authenticator in Admin → Live chat.
        </p>
      </section>
      <section aria-labelledby="requests">
        <h2 id="requests" className="mb-3 text-base font-semibold">Waiting for approval ({requests.length})</h2>
        {requests.length === 0 ? <p className="text-sm text-muted">No requests right now.</p> : <ul className="flex flex-col gap-3">{requests.map((r) => <RequestRow key={r.id} r={r} />)}</ul>}
      </section>
      <section aria-labelledby="members">
        <h2 id="members" className="mb-3 text-base font-semibold">Support team ({team.length})</h2>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {team.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{m.name}</p>
                <p className="truncate text-muted">{m.email}</p>
              </div>
              <p className="text-muted">
                {ROLE[m.role] ?? m.role} · {STATUS[m.status] ?? m.status} · last seen {when(m.lastSeenAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
