import { StaffView } from "@/components/admin/organisation/staff-view";
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
    <StaffView
      staff={staff}
      roles={roles}
      grantable={grantable}
      me={{ staffId: me.staffId, email: me.email }}
      actions={{ invite: inviteStaffAction, changeRole: changeStaffRoleAction, setDisabled: setStaffDisabledAction, remove: removeStaffAction }}
      ok={param(sp.notice)}
      bad={param(sp.error)}
    />
  );
}
