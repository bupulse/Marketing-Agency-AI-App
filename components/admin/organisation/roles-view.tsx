import { Check, Layers, Lock, Plus, Sparkles } from "lucide-react";
import { ExpandCard, PageHeader, StatusPill } from "@/components/admin/kit";
import { Button, Field, Input } from "@/components/ui";
import type { RoleView } from "@/lib/staff/service";
import { PERMISSIONS, type Permission } from "@/lib/staff/permissions";
import { ConfirmButton } from "../confirm-button";
import { Panel, Section } from "../ui";
import { Notices } from "../system/notices";

const GROUPS = ["Areas", "Actions"] as const;

/** Ticks as chips: a real checkbox each (posts permissions=<key>), a ring and a tick when chosen. */
function PermissionBoxes({ checked, allowed }: { checked: readonly Permission[]; allowed: readonly Permission[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {GROUPS.map((g) => (
        <fieldset key={g} className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{g === "Areas" ? "Pages they may open" : "Things they may do"}</legend>
          {(Object.entries(PERMISSIONS) as [Permission, { label: string; group: string }][])
            .filter(([, p]) => p.group === g)
            .map(([key, p]) => (
              <label
                key={key}
                className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 border-line px-3 py-2 text-[14px] transition-colors has-[:checked]:border-pulse-blue has-[:checked]:bg-pulse-blue/[0.07] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-pulse-blue/30 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 motion-reduce:transition-none dark:has-[:checked]:bg-pulse-blue/15"
              >
                <input type="checkbox" name="permissions" value={key} defaultChecked={checked.includes(key)} disabled={!allowed.includes(key)} className="peer sr-only" />
                <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border-2 border-line text-transparent peer-checked:border-pulse-blue peer-checked:bg-pulse-blue peer-checked:text-white">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                <span className="leading-snug">{p.label}</span>
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  );
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/** Built-in roles (read-only) and custom roles (name + ticked permissions). `allowed`: the permissions the editor may give. */
export function RolesView({ roles, allowed, actions, ok, bad }: { roles: RoleView[]; allowed: readonly Permission[]; actions: { save: (f: FormData) => Promise<void>; remove: (f: FormData) => Promise<void> }; ok?: string; bad?: string }) {
  const builtIn = roles.filter((r) => r.builtIn);
  const custom = roles.filter((r) => !r.builtIn);
  return (
    <>
      <PageHeader icon={Layers} tone="indigo" title="Roles" description="What each role may see and do. Built-in roles are fixed; make a custom role for any other mix. Tap a role to see it." back={{ href: "/admin/organisation", label: "Staff" }} />
      <Notices ok={ok} bad={bad} />

      <Section title="Built-in roles" description="Ready to give; they cannot be changed.">
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {builtIn.map((r) => (
            <ExpandCard key={r.key} icon={Lock} tone="indigo" title={r.name} summary={r.description} aside={<StatusPill tone="muted">{people(r.members)}</StatusPill>}>
              <ul className="flex flex-wrap gap-1.5">
                {r.permissions.map((p) => (
                  <li key={p}>
                    <StatusPill tone="info">{PERMISSIONS[p].label}</StatusPill>
                  </li>
                ))}
              </ul>
            </ExpandCard>
          ))}
        </div>
      </Section>

      <Section title="Custom roles" description={custom.length ? "Your own mixes. Open one to change it." : "None yet: make one below."}>
        {custom.length > 0 && (
          <div className="grid items-start gap-3">
            {custom.map((r) => (
              <ExpandCard key={r.key} icon={Sparkles} tone="violet" title={r.name} summary={`${r.permissions.length} ${r.permissions.length === 1 ? "permission" : "permissions"}`} aside={<StatusPill tone="new">{people(r.members)}</StatusPill>}>
                <div className="flex flex-col gap-4">
                  <form action={actions.save} className="flex flex-col gap-4">
                    <input type="hidden" name="key" value={r.key} />
                    <Field label="Name">
                      <Input name="name" defaultValue={r.name} required minLength={2} maxLength={40} />
                    </Field>
                    <PermissionBoxes checked={r.permissions} allowed={allowed} />
                    <Button type="submit" size="sm" className="self-start">Save</Button>
                  </form>
                  {/* Outside the save form: the delete dialog has its own form, and forms cannot nest. */}
                  <div className="border-t border-line pt-3">
                    <ConfirmButton action={actions.remove} fields={{ key: r.key }} label="Delete this role" title={`Delete ${r.name}?`} description="Only a role nobody has can be deleted." confirmLabel="Delete" />
                  </div>
                </div>
              </ExpandCard>
            ))}
          </div>
        )}
        <Panel icon={Plus} tone="indigo" title="Make a custom role" description="Name it and tick what it may see and do. You can only give permissions you have yourself.">
          <form action={actions.save} className="flex flex-col gap-4">
            <Field label="Name" required>
              <Input name="name" required minLength={2} maxLength={40} placeholder="Night support" />
            </Field>
            <PermissionBoxes checked={[]} allowed={allowed} />
            <Button type="submit" className="self-start">Create role</Button>
          </form>
        </Panel>
      </Section>
    </>
  );
}
