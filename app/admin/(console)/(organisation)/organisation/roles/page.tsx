import { PageHeader } from "@/components/app";
import { RolesView } from "@/components/admin/organisation/roles-view";
import { notice } from "@/components/admin/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listRoles } from "@/lib/staff/service";
import { deleteRoleAction, saveRoleAction } from "../actions";

export const metadata = { title: "Roles" };

export default async function RolesPage({ searchParams }: PageProps<"/admin/organisation/roles">) {
  const me = await requirePermission("staff.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const roles = await listRoles();
  return (
    <>
      <PageHeader title="Roles" description="What each role may see and do. Built-in roles are fixed; make a custom role for any other mix." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <RolesView roles={roles} allowed={me.permissions} actions={{ save: saveRoleAction, remove: deleteRoleAction }} />
    </>
  );
}
