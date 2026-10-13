import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { RoleView, StaffView } from "@/lib/staff/service";
import { ConfirmButton } from "../confirm-button";
import { Empty, Panel, TableWrap, Td, Th } from "../ui";

type Actions = {
  invite: (f: FormData) => Promise<void>;
  changeRole: (f: FormData) => Promise<void>;
  setDisabled: (f: FormData) => Promise<void>;
  remove: (f: FormData) => Promise<void>;
};

const STATUS_TONE = { active: "success", invited: "violet", disabled: "neutral" } as const;

/** Staff list and the invite form. `grantable`: the roles the signed-in person may give (the owner: all). */
export function StaffView({ staff, roles, grantable, me, actions }: { staff: StaffView[]; roles: RoleView[]; grantable: string[]; me: { staffId: string | null; email: string }; actions: Actions }) {
  const options = roles.filter((r) => grantable.includes(r.key));
  return (
    <>
      <Panel title="Invite someone" description="They sign in at /admin with their own account (Google or password) and add an authenticator app, like the owner. The role decides what they see.">
        <form action={actions.invite} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
          <Field label="Email" required><Input name="email" type="email" required maxLength={254} placeholder="name@example.com" /></Field>
          <Field label="Name"><Input name="name" maxLength={80} /></Field>
          <Field label="Phone (optional)"><Input name="phone" maxLength={30} inputMode="tel" /></Field>
          <Field label="Role" required>
            <Select name="roleKey" defaultValue="sales_agent" required>
              {options.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          </Field>
          <Button type="submit">Send invitation</Button>
        </form>
      </Panel>
      <Panel title={`Staff (${staff.length})`} description="The owner (the addresses in ADMIN_EMAILS) is not listed: they always have every permission.">
        {staff.length === 0 ? (
          <Empty>Nobody yet. Invite your first team member above.</Empty>
        ) : (
          <TableWrap caption="Staff">
            <thead><tr><Th>Person</Th><Th>Role</Th><Th>Status</Th><Th>Referral code</Th><Th>Last sign-in</Th><Th /></tr></thead>
            <tbody>
              {staff.map((s) => {
                const self = s.id === me.staffId || s.email === me.email;
                return (
                  <tr key={s.id}>
                    <Td className="max-w-[16rem]"><span className="block truncate font-medium">{s.name ?? s.email}</span><span className="block truncate text-xs text-muted">{s.email}</span></Td>
                    <Td>
                      {self || !grantable.includes(s.roleKey) ? (
                        s.roleName
                      ) : (
                        <form action={actions.changeRole} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={s.id} />
                          <Select name="roleKey" defaultValue={s.roleKey} aria-label={`Role of ${s.email}`} className="min-h-11">
                            {options.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                          </Select>
                          <Button type="submit" size="sm" variant="outline">Save</Button>
                        </form>
                      )}
                    </Td>
                    <Td><Badge tone={STATUS_TONE[s.status as keyof typeof STATUS_TONE] ?? "neutral"}>{s.status}</Badge></Td>
                    <Td>{s.refCode ? <code className="font-mono text-[13px]">{s.refCode}</code> : <span className="text-muted">none</span>}</Td>
                    <Td className="whitespace-nowrap">{s.lastSignInAt ? dateTime(s.lastSignInAt) : <span className="text-muted">Never</span>}</Td>
                    <Td right>
                      {self ? (
                        <span className="text-xs text-muted">You</span>
                      ) : (
                        <span className="flex justify-end gap-2">
                          {s.status === "disabled" ? (
                            <>
                              <form action={actions.setDisabled}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="disabled" value="0" /><Button type="submit" size="sm" variant="outline">Enable</Button></form>
                              <ConfirmButton action={actions.remove} fields={{ id: s.id }} label="Remove" title={`Remove ${s.email}?`} description="They leave the staff list. Their past sales stay in the history." confirmLabel="Remove" />
                            </>
                          ) : (
                            <ConfirmButton action={actions.setDisabled} fields={{ id: s.id, disabled: "1" }} label="Disable" title={`Disable ${s.email}?`} description="They can no longer open the console, from their next click. Their clients stay assigned until a sales manager reassigns them." confirmLabel="Disable" />
                          )}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
