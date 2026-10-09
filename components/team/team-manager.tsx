"use client";

import { useState, useTransition } from "react";
import { Crown, Mail, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, Field, GlassCard, Input, Select, useToast } from "@/components/ui";
import {
  cancelInviteAction,
  changeRoleAction,
  inviteAction,
  removeMemberAction,
  resendInviteAction,
  setAlertsAction,
  transferOwnershipAction,
  type TeamResult,
} from "@/app/dashboard/settings/team/actions";
import { assignableRoles, ROLE_HELP, ROLE_LABEL, type Role } from "@/lib/team/roles";

type Member = { userId: string; role: Role; email: string; name: string | null; joinedAt: string; isCompanyAccount: boolean };
type Invite = { id: string; email: string; role: Role; expiresAt: string; createdAt: string; expired: boolean };

/** Members, pending invitations and the owner-only actions. The server re-checks every role; this only shapes the page. */
export function TeamManager({ me, role, limit, members, invites, alertsOn, history }: { me: string; role: Role; limit: number; members: Member[]; invites: Invite[]; alertsOn: boolean; history: { id: string; at: string; text: string }[] }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [transferring, setTransferring] = useState<Member | null>(null);
  const open = invites.filter((i) => !i.expired).length;
  const used = members.length + open;
  const roles = assignableRoles(role);

  const done = (result: TeamResult, after?: () => void) => {
    if (result.ok) {
      toast(result.message ?? "Done.", "success");
      after?.();
    } else {
      toast(result.error, "error");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <GlassCard as="section" aria-labelledby="invite" className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="invite" className="text-lg font-semibold">Invite someone</h2>
          <p className="text-sm text-muted" aria-live="polite">{used} of {limit} {limit === 1 ? "seat" : "seats"} used</p>
        </div>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            start(async () => {
              const result = await inviteAction({ email, role: inviteRole });
              if (result.ok) {
                setEmail("");
                done(result);
              } else setFormError(result.error);
            });
          }}
        >
          <Field label="Email address" error={formError ?? undefined}>
            <Input type="email" name="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
          </Field>
          <Field label="Role">
            <Select name="role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
          <Button type="submit" disabled={pending || !email.trim()}>{pending ? "Sending…" : "Send invitation"}</Button>
        </form>
        <p className="text-sm text-muted">{ROLE_HELP[inviteRole]}</p>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="members" className="flex flex-col gap-3 p-5 sm:p-6">
        <h2 id="members" className="text-lg font-semibold">People ({members.length})</h2>
        <ul className="flex flex-col divide-y divide-line">
          {members.map((m) => {
            const mine = m.userId === me;
            const manageable = m.role !== "OWNER" && !mine && !m.isCompanyAccount;
            return (
              <li key={m.userId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.name || m.email}{mine && <span className="text-muted"> (you)</span>}</p>
                  {m.name && <p className="truncate text-sm text-muted">{m.email}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.role === "OWNER" ? (
                    <Badge tone="violet"><Crown aria-hidden className="mr-1 inline size-3" />Owner</Badge>
                  ) : manageable ? (
                    <Select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={pending}
                      className="min-h-10 py-2"
                      onChange={(e) => start(async () => done(await changeRoleAction(m.userId, e.target.value)))}
                    >
                      {assignableRoles(role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                  ) : (
                    <Badge>{ROLE_LABEL[m.role]}</Badge>
                  )}
                  {role === "OWNER" && m.role !== "OWNER" && !mine && (
                    <Button variant="outline" size="sm" onClick={() => setTransferring(m)}>Make owner</Button>
                  )}
                  {manageable && (
                    <Button variant="ghost" size="sm" aria-label={`Remove ${m.email}`} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setRemoving(m)}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </GlassCard>

      {invites.length > 0 && (
        <GlassCard as="section" aria-labelledby="pending" className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="pending" className="text-lg font-semibold">Pending invitations ({invites.length})</h2>
          <ul className="flex flex-col divide-y divide-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Mail aria-hidden className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.email}</p>
                    <p className="text-sm text-muted">{ROLE_LABEL[i.role]} · {i.expired ? "expired" : `expires ${new Date(i.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => done(await resendInviteAction(i.id)))}>Resend</Button>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => done(await cancelInviteAction(i.id)))}>Cancel</Button>
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      {role === "ADMIN" && (
        <GlassCard as="section" aria-labelledby="alerts" className="flex flex-col gap-2 p-5 sm:p-6">
          <h2 id="alerts" className="text-lg font-semibold">Your email alerts</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4" defaultChecked={alertsOn} disabled={pending} onChange={(e) => start(async () => done(await setAlertsAction(e.target.checked)))} />
            <span>Also email me the owner&apos;s new-lead, daily digest, post reminder and failure emails.</span>
          </label>
        </GlassCard>
      )}

      {history.length > 0 && (
        <GlassCard as="section" aria-labelledby="history" className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="history" className="text-lg font-semibold">Recent team changes</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2"><span>{h.text}</span><span className="text-muted">{new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>
            ))}
          </ul>
        </GlassCard>
      )}

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Remove this person?" description={removing ? `${removing.email} loses access and their sign-in is deleted. Everything they created for the company stays.` : undefined}>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>Keep</Button>
          <Button
            className="bg-danger bg-none text-white shadow-none"
            disabled={pending}
            onClick={() => { const m = removing; if (m) start(async () => { done(await removeMemberAction(m.userId), () => setRemoving(null)); }); }}
          >
            Remove
          </Button>
        </div>
      </Dialog>

      <Dialog open={!!transferring} onOpenChange={(o) => !o && setTransferring(null)} title="Transfer ownership?" description={transferring ? `${transferring.email} becomes the owner: billing, the plan and deleting the company. You become an Admin and cannot undo this yourself.` : undefined}>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={() => setTransferring(null)}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() => { const m = transferring; if (m) start(async () => { done(await transferOwnershipAction(m.userId), () => { setTransferring(null); window.location.reload(); }); }); }}
          >
            Transfer ownership
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
