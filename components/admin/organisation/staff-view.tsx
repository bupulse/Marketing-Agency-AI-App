import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { DataList, EmptyState, PageHeader, StatGrid, StatTile, StatusPill, type PillTone } from "@/components/admin/kit";
import { RadioChips } from "@/components/admin/kit/form-choices";
import { Button, Field, Input, PhoneInput } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { RoleView, StaffView } from "@/lib/staff/service";
import { ConfirmButton } from "../confirm-button";
import { Panel } from "../ui";
import { Notices } from "../system/notices";

type Actions = {
  invite: (f: FormData) => Promise<void>;
  changeRole: (f: FormData) => Promise<void>;
  setDisabled: (f: FormData) => Promise<void>;
  remove: (f: FormData) => Promise<void>;
};

const STATUS: Record<string, { label: string; tone: PillTone }> = { active: { label: "Active", tone: "good" }, invited: { label: "Invited", tone: "new" }, disabled: { label: "Disabled", tone: "muted" } };

/** Staff list and the invite form. `grantable`: the roles the signed-in person may give (the owner: all). */
export function StaffView({ staff, roles, grantable, me, actions, ok, bad }: { staff: StaffView[]; roles: RoleView[]; grantable: string[]; me: { staffId: string | null; email: string }; actions: Actions; ok?: string; bad?: string }) {
  const options = roles.filter((r) => grantable.includes(r.key));
  const roleChoices = options.map((r) => ({ value: r.key, label: r.name }));
  const active = staff.filter((s) => s.status === "active").length;
  const invited = staff.filter((s) => s.status === "invited").length;
  return (
    <>
      <PageHeader icon={ShieldCheck} tone="indigo" title="Staff" description="Who works in the console and with which role. Every change is in the audit log." />
      <Notices ok={ok} bad={bad} />
      <StatGrid cols={3}>
        <StatTile icon={Users} tone="indigo" label="Working now" value={String(active)} hint="Staff who can sign in." />
        <StatTile icon={UserPlus} tone="indigo" label="Invited" value={String(invited)} hint="Have not signed in yet." />
        <StatTile icon={ShieldCheck} tone="indigo" label="Roles" value={String(roles.length)} hint="Built-in and custom." href="/admin/organisation/roles" />
      </StatGrid>

      <Panel title={`Team (${staff.length})`} description="The owner (the addresses in ADMIN_EMAILS) is not listed: they always have every permission.">
        <DataList<StaffView>
          caption="Staff"
          rows={staff}
          rowKey={(s) => s.id}
          columns={[
            {
              key: "person",
              header: "Person",
              primary: true,
              cell: (s) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{s.name ?? s.email}</span>
                  {s.name && <span className="truncate text-[12.5px] font-normal text-muted">{s.email}</span>}
                </span>
              ),
            },
            { key: "role", header: "Role", cell: (s) => s.roleName },
            { key: "status", header: "Status", cell: (s) => <StatusPill tone={STATUS[s.status]?.tone ?? "muted"} dot>{STATUS[s.status]?.label ?? s.status}</StatusPill> },
            { key: "seen", header: "Last sign-in", cell: (s) => (s.lastSignInAt ? dateTime(s.lastSignInAt) : <span className="text-muted">Never</span>), hideOnPhone: true },
            { key: "ref", header: "Referral code", cell: (s) => (s.refCode ? <code className="font-mono text-[13px]">{s.refCode}</code> : <span className="text-muted">none</span>), hideOnPhone: true },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right",
              cell: (s) => {
                const self = s.id === me.staffId || s.email === me.email;
                if (self) return <span className="text-xs text-muted">You</span>;
                return (
                  <span className="flex flex-wrap gap-2 md:justify-end max-md:w-[calc(200%+0.75rem)]">
                    {grantable.includes(s.roleKey) && (
                      <ConfirmButton action={actions.changeRole} fields={{ id: s.id }} label="Change role" title={`Role of ${s.name ?? s.email}`} description="What they may see and do changes from their next click. Written to the audit log." confirmLabel="Save role">
                        <RadioChips name="roleKey" legend="Role" required defaultValue={s.roleKey} options={roleChoices} />
                      </ConfirmButton>
                    )}
                    {s.status === "disabled" ? (
                      <>
                        <form action={actions.setDisabled}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="disabled" value="0" />
                          <Button type="submit" size="sm" variant="outline">Enable</Button>
                        </form>
                        <ConfirmButton action={actions.remove} fields={{ id: s.id }} label="Remove" title={`Remove ${s.email}?`} description="They leave the staff list. Their past sales stay in the history." confirmLabel="Remove" />
                      </>
                    ) : (
                      <ConfirmButton action={actions.setDisabled} fields={{ id: s.id, disabled: "1" }} label="Disable" title={`Disable ${s.email}?`} description="They can no longer open the console, from their next click. Their clients stay assigned until a sales manager reassigns them." confirmLabel="Disable" />
                    )}
                  </span>
                );
              },
            },
          ]}
          empty={<EmptyState icon={Users} title="Nobody yet." hint="Invite your first team member below." />}
        />
      </Panel>

      <Panel icon={UserPlus} tone="indigo" title="Invite someone" description="They sign in at /admin/login like you: their email, a code we email them, then an authenticator app. The role decides what they see.">
        <form action={actions.invite} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Email" required>
              <Input name="email" type="email" required maxLength={254} placeholder="name@example.com" />
            </Field>
            <Field label="Name">
              <Input name="name" maxLength={80} />
            </Field>
            <PhoneInput name="phone" label="Phone (optional)" />
          </div>
          <RadioChips name="roleKey" legend="Role" required defaultValue={options.some((r) => r.key === "sales_agent") ? "sales_agent" : options[0]?.key} options={options.map((r) => ({ value: r.key, label: r.name, hint: r.description }))} tiles />
          <div>
            <Button type="submit">Send invitation</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
