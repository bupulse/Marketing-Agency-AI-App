import { RolesView } from "@/components/admin/organisation/roles-view";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listRoles } from "@/lib/staff/service";
import { deleteRoleAction, saveRoleAction } from "../actions";

export const metadata = { title: "Roles" };

export default async function RolesPage({ searchParams }: PageProps<"/admin/organisation/roles">) {
  const me = await requirePermission("staff.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const roles = await listRoles();
  return <RolesView roles={roles} allowed={me.permissions} actions={{ save: saveRoleAction, remove: deleteRoleAction }} ok={param(sp.notice)} bad={param(sp.error)} />;
}
