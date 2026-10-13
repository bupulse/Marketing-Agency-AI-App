import { Badge, Button, Field, Input } from "@/components/ui";
import type { RoleView } from "@/lib/staff/service";
import { PERMISSIONS, type Permission } from "@/lib/staff/permissions";
import { ConfirmButton } from "../confirm-button";
import { Panel } from "../ui";

const GROUPS = ["Areas", "Actions"] as const;

function PermissionBoxes({ checked, allowed }: { checked: readonly Permission[]; allowed: readonly Permission[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {GROUPS.map((g) => (
        <fieldset key={g} className="flex flex-col gap-1">
          <legend className="mb-1 text-[13px] font-semibold text-muted">{g}</legend>
          {(Object.entries(PERMISSIONS) as [Permission, { label: string; group: string }][])
            .filter(([, p]) => p.group === g)
            .map(([key, p]) => (
              <label key={key} className="flex min-h-11 items-center gap-3 text-[14px]">
                <input type="checkbox" name="permissions" value={key} defaultChecked={checked.includes(key)} disabled={!allowed.includes(key)} className="size-5" />
                <span>{p.label}</span>
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  );
}

/** Built-in roles (read-only) and custom roles (name + ticked permissions). `allowed`: the permissions the editor may give. */
export function RolesView({ roles, allowed, actions }: { roles: RoleView[]; allowed: readonly Permission[]; actions: { save: (f: FormData) => Promise<void>; remove: (f: FormData) => Promise<void> } }) {
  return (
    <>
      <Panel title="Make a custom role" description="Name it and tick what it may see and do. You can only give permissions you have yourself.">
        <form action={actions.save} className="flex flex-col gap-4">
          <Field label="Name" required><Input name="name" required minLength={2} maxLength={40} placeholder="Night support" /></Field>
          <PermissionBoxes checked={[]} allowed={allowed} />
          <Button type="submit" className="self-start">Create role</Button>
        </form>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        {roles.map((r) => (
          <Panel key={r.key} title={r.name} description={r.description} action={<Badge tone={r.builtIn ? "neutral" : "violet"}>{r.builtIn ? "built-in" : "custom"} · {r.members} {r.members === 1 ? "person" : "people"}</Badge>}>
            {r.builtIn ? (
              <ul className="flex flex-wrap gap-1.5">
                {r.permissions.map((p) => <li key={p}><Badge tone="blue">{PERMISSIONS[p].label}</Badge></li>)}
              </ul>
            ) : (
              <form action={actions.save} className="flex flex-col gap-4">
                <input type="hidden" name="key" value={r.key} />
                <Field label="Name"><Input name="name" defaultValue={r.name} required minLength={2} maxLength={40} /></Field>
                <PermissionBoxes checked={r.permissions} allowed={allowed} />
                <span className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm">Save</Button>
                  <ConfirmButton action={actions.remove} fields={{ key: r.key }} label="Delete" title={`Delete ${r.name}?`} description="Only a role nobody has can be deleted." confirmLabel="Delete" />
                </span>
              </form>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
