import { PageHeader } from "@/components/app";
import { StaffView } from "@/components/admin/organisation/staff-view";
import { notice } from "@/components/admin/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listRoles, listStaff } from "@/lib/staff/service";
import { changeStaffRoleAction, inviteStaffAction, removeStaffAction, setStaffDisabledAction } from "./actions";

export const metadata = { title: "Staff" };

export default async function StaffPage({ searchParams }: PageProps<"/admin/organisation">) {
  const me = await requirePermission("staff.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [staff, roles] = await Promise.all([listStaff(), listRoles()]);
  // The roles this person may give: everything for the owner, else only roles within their own permissions.
  const grantable = roles.filter((r) => me.isOwner || (r.key !== "owner" && r.permissions.every((p) => me.permissions.includes(p)))).map((r) => r.key);
  return (
    <>
      <PageHeader title="Staff" description="Who works in the console and with which role. Every change is in the audit log." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <StaffView staff={staff} roles={roles} grantable={grantable} me={{ staffId: me.staffId, email: me.email }} actions={{ invite: inviteStaffAction, changeRole: changeStaffRoleAction, setDisabled: setStaffDisabledAction, remove: removeStaffAction }} />
    </>
  );
}
