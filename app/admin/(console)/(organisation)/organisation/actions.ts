"use server";

import { requirePermission } from "@/lib/admin/auth";
import { adminAction, finish } from "@/lib/admin/console";
import { changeStaffRole, deleteCustomRole, inviteStaff, removeStaff, saveCustomRole, setStaffDisabled } from "@/lib/staff/service";

// Staff and roles. adminAction("staff.manage") re-checks the person (AAL2) and the permission on every call; the
// service refuses changing yourself, touching an Owner unless you are the owner, and giving permissions you lack.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function staffManager() {
  const ctx = await adminAction("staff.manage");
  return { ctx, actor: await requirePermission("staff.manage") };
}

export async function inviteStaffAction(f: FormData) {
  const { ctx, actor } = await staffManager();
  await finish("/admin/organisation", (r: { emailed: boolean }) => (r.emailed ? "Invitation sent." : "Added, but the invitation email could not be sent. Ask them to sign in at /admin."), () =>
    inviteStaff(ctx, actor, { email: text(f, "email"), name: text(f, "name"), phone: text(f, "phone"), roleKey: text(f, "roleKey") }),
  );
}

export async function changeStaffRoleAction(f: FormData) {
  const { ctx, actor } = await staffManager();
  await finish("/admin/organisation", "Role changed.", () => changeStaffRole(ctx, actor, text(f, "id"), text(f, "roleKey")));
}

export async function setStaffDisabledAction(f: FormData) {
  const { ctx, actor } = await staffManager();
  const disabled = text(f, "disabled") === "1";
  await finish("/admin/organisation", disabled ? "Disabled. They can no longer open the console." : "Enabled again.", () => setStaffDisabled(ctx, actor, text(f, "id"), disabled));
}

export async function removeStaffAction(f: FormData) {
  const { ctx, actor } = await staffManager();
  await finish("/admin/organisation", "Removed from the staff list.", () => removeStaff(ctx, actor, text(f, "id")));
}

export async function saveRoleAction(f: FormData) {
  const { ctx, actor } = await staffManager();
  await finish("/admin/organisation/roles", "Role saved.", () => saveCustomRole(ctx, actor, { key: text(f, "key") || undefined, name: text(f, "name"), permissions: f.getAll("permissions").map(String) }));
}

export async function deleteRoleAction(f: FormData) {
  const { ctx, actor } = await staffManager();
  await finish("/admin/organisation/roles", "Role deleted.", () => deleteCustomRole(ctx, actor, text(f, "key")));
}
