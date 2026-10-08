import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { param } from "@/lib/admin/format";
import { listFeatureFlags } from "@/lib/admin/service";
import { prisma } from "@/lib/db";
import { flagOverrideAction, saveFlagAction } from "../actions";

export const metadata = { title: "Feature flags" };

export default async function FlagsPage({ searchParams }: PageProps<"/admin/flags">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const flags = await listFeatureFlags();
  const ids = [...new Set(flags.flatMap((f) => Object.keys((f.userOverrides as Record<string, boolean> | null) ?? {})))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  const email = new Map(users.map((u) => [u.id, u.email]));

  return (
    <>
      <PageHeader title="Feature flags" description="Switch features on for everyone, a share of users, or named users. A flag that is off is off for everyone except forced-on users." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel title="New flag">
        <form action={saveFlagAction} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input type="hidden" name="create" value="1" />
          <Field label="Key" hint="Lowercase letters, numbers, dots, dashes, underscores."><Input name="key" required maxLength={64} pattern="[a-z0-9][a-z0-9_.\-]*" placeholder="new-composer" /></Field>
          <Field label="What it does"><Input name="description" maxLength={200} /></Field>
          <Button type="submit">Create (off)</Button>
        </form>
      </Panel>

      {flags.length === 0 ? (
        <Empty>No flags yet. Code asks for a flag by key; create the key here to control it.</Empty>
      ) : (
        flags.map((f) => {
          const overrides = Object.entries((f.userOverrides as Record<string, boolean> | null) ?? {});
          return (
            <Panel key={f.key} title={f.key} description={f.description ?? undefined} action={<Badge tone={f.enabled ? "success" : "neutral"}>{f.enabled ? `On, ${f.rolloutPercent}%` : "Off"}</Badge>}>
              <form action={saveFlagAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="key" value={f.key} />
                <Field label="State"><Select name="enabled" defaultValue={f.enabled ? "on" : "off"}><option value="on">On</option><option value="off">Off</option></Select></Field>
                <Field label="Rollout (% of users)"><Input name="rollout" type="number" min={0} max={100} defaultValue={f.rolloutPercent} className="w-28" /></Field>
                <Button type="submit" variant="outline">Save</Button>
              </form>
              <div className="flex flex-col gap-2">
                <h3 className="text-[15px] font-semibold">Per-user overrides</h3>
                {overrides.length === 0 ? (<p className="text-sm text-muted">None.</p>) : (
                  <ul className="flex flex-col gap-1.5 text-[14px]">
                    {overrides.map(([uid, on]) => (
                      <li key={uid} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{email.get(uid) ?? uid} · forced {on ? "on" : "off"}</span>
                        <form action={flagOverrideAction}><input type="hidden" name="key" value={f.key} /><input type="hidden" name="userId" value={uid} /><input type="hidden" name="value" value="remove" /><Button type="submit" size="sm" variant="outline">Remove</Button></form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={flagOverrideAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="key" value={f.key} />
                  <Field label="Add override by email"><Input name="email" type="email" required placeholder="person@example.com" /></Field>
                  <Select name="value" aria-label="Override value" defaultValue="on" className="min-h-12"><option value="on">Forced on</option><option value="off">Forced off</option></Select>
                  <Button type="submit" variant="outline">Add</Button>
                </form>
              </div>
            </Panel>
          );
        })
      )}
    </>
  );
}
