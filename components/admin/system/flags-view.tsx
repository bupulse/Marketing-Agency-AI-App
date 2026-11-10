import { Flag, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { EmptyState, ExpandCard, PageHeader, StatusPill } from "@/components/admin/kit";
import { RadioChips } from "@/components/admin/kit/form-choices";
import { Panel } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui";
import { flagOverrideAction, saveFlagAction } from "@/app/admin/(console)/actions";
import { Notices } from "./notices";

export type FlagRow = { key: string; description: string | null; enabled: boolean; rolloutPercent: number; overrides: { userId: string; label: string; on: boolean }[] };

const ON_OFF = [
  { value: "on", label: "On", icon: ToggleRight },
  { value: "off", label: "Off", icon: ToggleLeft },
];

/** Admin -> Feature flags: one card per flag that opens to change it; a small form to make a new one. */
export function FlagsView({ flags, ok, bad }: { flags: FlagRow[]; ok?: string; bad?: string }) {
  const on = flags.filter((f) => f.enabled).length;
  return (
    <>
      <PageHeader icon={Flag} tone="slate" title="Feature flags" description="Switch a feature on for everyone, a share of users, or named people. A flag that is off is off for everyone except people forced on." />
      <Notices ok={ok} bad={bad} />

      <section aria-label="Flags" className="flex flex-col gap-3">
        <p className="px-1 text-[13px] text-muted">{flags.length === 0 ? "No flags yet." : `${on} of ${flags.length} ${flags.length === 1 ? "flag is" : "flags are"} on. Tap a flag to change it.`}</p>
        {flags.length === 0 ? (
          <EmptyState icon={Flag} title="No flags yet." hint="Code asks for a flag by key; create the key below to control it." />
        ) : (
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {flags.map((f) => (
              <ExpandCard
                key={f.key}
                icon={Flag}
                tone={f.enabled ? "green" : "slate"}
                title={<code className="font-mono text-[14px]">{f.key}</code>}
                summary={f.description ?? "No description."}
                aside={f.enabled ? <StatusPill tone="good" dot>On, {f.rolloutPercent}%</StatusPill> : <StatusPill tone="muted" dot>Off</StatusPill>}
              >
                <div className="flex flex-col gap-4">
                  <form action={saveFlagAction} className="flex flex-col gap-3">
                    <input type="hidden" name="key" value={f.key} />
                    <RadioChips name="enabled" legend="State" defaultValue={f.enabled ? "on" : "off"} options={ON_OFF} />
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Share of users (%)">
                        <Input name="rollout" type="number" min={0} max={100} defaultValue={f.rolloutPercent} className="w-28" />
                      </Field>
                      <Button type="submit" size="sm">Save</Button>
                    </div>
                  </form>
                  <div className="flex flex-col gap-2 border-t border-line pt-4">
                    <h3 className="text-[14px] font-semibold">People forced on or off</h3>
                    {f.overrides.length === 0 ? (
                      <p className="text-[13px] text-muted">Nobody.</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5 text-[14px]">
                        {f.overrides.map((o) => (
                          <li key={o.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-soft px-3 py-2">
                            <span className="min-w-0 truncate">
                              {o.label} · <StatusPill tone={o.on ? "good" : "muted"}>forced {o.on ? "on" : "off"}</StatusPill>
                            </span>
                            <form action={flagOverrideAction}>
                              <input type="hidden" name="key" value={f.key} />
                              <input type="hidden" name="userId" value={o.userId} />
                              <input type="hidden" name="value" value="remove" />
                              <Button type="submit" size="sm" variant="outline" aria-label={`Remove the override for ${o.label}`}>
                                Remove
                              </Button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form action={flagOverrideAction} className="flex flex-col gap-3">
                      <input type="hidden" name="key" value={f.key} />
                      <Field label="Add someone by email">
                        <Input name="email" type="email" required placeholder="person@example.com" />
                      </Field>
                      <div className="flex flex-wrap items-end gap-3">
                        <RadioChips name="value" legend="For them" defaultValue="on" options={[{ value: "on", label: "Forced on" }, { value: "off", label: "Forced off" }]} />
                        <Button type="submit" size="sm" variant="outline">Add</Button>
                      </div>
                    </form>
                  </div>
                </div>
              </ExpandCard>
            ))}
          </div>
        )}
      </section>

      <Panel icon={Plus} tone="slate" title="New flag" description="It starts off. Code asks for it by this key.">
        <form action={saveFlagAction} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input type="hidden" name="create" value="1" />
          <Field label="Key" hint="Lowercase letters, numbers, dots, dashes, underscores.">
            <Input name="key" required maxLength={64} pattern="[a-z0-9][a-z0-9_.\-]*" placeholder="new-composer" />
          </Field>
          <Field label="What it does">
            <Input name="description" maxLength={200} />
          </Field>
          <Button type="submit" className="sm:mt-[30px]">Create (off)</Button>
        </form>
      </Panel>
    </>
  );
}
