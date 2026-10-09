import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th } from "@/components/admin/ui";
import { Badge, Button, Select } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { ROLE_LABEL, type Role } from "@/lib/team/roles";
import { addCompanyUserAction, changeEmailAction, changeRoleAction, removeUserAction, sendResetAction } from "@/app/admin/(console)/companies/actions";
import { AddUserDialog, ChangeEmailDialog } from "./company-users-client";

type CompanyUsers = {
  id: string;
  seatLimit: number;
  users: { userId: string; email: string; name: string | null; role: Role; suspended: boolean; joinedAt: string; lastSignInAt: string | null; isCompanyAccount: boolean }[];
  invites: { id: string; email: string; role: Role; expiresAt: string }[];
};

/** The Users tab of a company: people, their actions, and "Add user". Actions are server actions that re-check the admin. */
export function CompanyUsers({ company }: { company: CompanyUsers }) {
  const used = company.users.length + company.invites.length;
  return (
    <Panel
      title={`Users (${company.users.length} of ${company.seatLimit} seats)`}
      action={<AddUserDialog action={addCompanyUserAction} businessId={company.id} />}
    >
      {company.users.length === 0 ? (
        <Empty>No users yet.</Empty>
      ) : (
        <TableWrap caption="Company users">
          <thead><tr><Th>User</Th><Th>Role</Th><Th>Last sign-in</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {company.users.map((u) => (
              <tr key={u.userId}>
                <Td className="max-w-[16rem]">
                  <span className="block truncate font-medium">{u.email}</span>
                  {u.name && <span className="block truncate text-xs text-muted">{u.name}</span>}
                  {u.isCompanyAccount && <span className="block text-xs text-muted">Company account (billing and files)</span>}
                  {u.suspended && <Badge tone="danger">Suspended</Badge>}
                </Td>
                <Td>
                  <form action={changeRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="businessId" value={company.id} />
                    <input type="hidden" name="userId" value={u.userId} />
                    <Select name="role" defaultValue={u.role} aria-label={`Role for ${u.email}`} className="min-h-10 py-2">
                      {(["OWNER", "ADMIN", "MEMBER"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                    <Button type="submit" size="sm" variant="outline">Set</Button>
                  </form>
                </Td>
                <Td className="whitespace-nowrap">{u.lastSignInAt ? dateTime(u.lastSignInAt) : <span className="text-muted">Never</span>}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <ConfirmButton
                      action={sendResetAction}
                      fields={{ businessId: company.id, userId: u.userId }}
                      label="Send reset link"
                      title="Send a password reset link?"
                      description={`${u.email} gets an email with a link to choose a new password. You never see or set the password.`}
                      confirmLabel="Send link"
                    />
                    <ChangeEmailDialog action={changeEmailAction} businessId={company.id} userId={u.userId} email={u.email} />
                    {u.role !== "OWNER" && !u.isCompanyAccount && (
                      <ConfirmButton
                        action={removeUserAction}
                        fields={{ businessId: company.id, userId: u.userId }}
                        label="Remove"
                        title="Remove this user?"
                        description={`${u.email} loses access and their sign-in is deleted. The company's content and data stay. This is recorded in the audit log.`}
                        confirmLabel="Remove user"
                        variant="outline"
                      />
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {company.invites.length > 0 && (
        <div className="mt-4 text-sm text-muted">
          <p className="font-medium text-text">Open invitations ({company.invites.length})</p>
          <ul className="mt-1">
            {company.invites.map((i) => <li key={i.id}>{i.email} · {ROLE_LABEL[i.role]} · expires {dateTime(i.expiresAt)}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{used} of {company.seatLimit} seats used, counting open invitations. Setting someone as Owner hands ownership over and makes the previous owner an Admin.</p>
    </Panel>
  );
}
