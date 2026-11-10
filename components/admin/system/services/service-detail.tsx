import { Activity, KeyRound, Plug, Power, TriangleAlert } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, PageHeader, StatusPill } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { ServiceView } from "@/lib/admin/services";
import { setServiceEnabledHereAction, testServiceHereAction } from "@/app/admin/(console)/(system)/services/actions";
import { Notices } from "../notices";
import { ServiceKeys } from "./service-keys";
import { HEALTH_PILL, ago, serviceTone } from "./service-status";

/** /admin/services/<id>: one service: its keys, Test now, the on/off switch, its last error and its usage. */
export function ServiceDetail({ s, ok, bad, now = new Date() }: { s: ServiceView; ok?: string; bad?: string; now?: Date }) {
  const pill = HEALTH_PILL[s.health];
  return (
    <>
      <PageHeader icon={Plug} tone={serviceTone(s.health)} title={s.name} description={s.purpose} back={{ href: "/admin/services", label: "Services" }} actions={<StatusPill tone={pill.tone} dot className="px-3 py-1 text-[13px]">{pill.label}</StatusPill>} />
      <Notices ok={ok} bad={bad} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel id="keys" icon={KeyRound} tone="slate" title="Keys" description={s.keysWhere === "here" ? "Add or replace a key: saved encrypted, used everywhere within 30 seconds. Only its last 4 characters are shown again." : "What this service needs to work."}>
          <ServiceKeys s={s} />
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel icon={Activity} tone="slate" title="Test" description="Asks the service whether it answers, with the key in use now.">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14px]">
                {s.lastCheck ? (
                  <>
                    Last test <strong className={s.lastCheck.ok ? "text-success" : "text-danger"}>{s.lastCheck.ok ? "passed" : "failed"}</strong> {ago(s.lastCheck.checkedAt, now)} <span className="text-muted">({s.lastCheck.latencyMs} ms, {dateTime(s.lastCheck.checkedAt)})</span>
                    {s.lastCheck.message && <span className="block text-[13px] text-muted">{s.lastCheck.message}</span>}
                  </>
                ) : (
                  <span className="text-muted">Never tested.</span>
                )}
              </p>
              <form action={testServiceHereAction}>
                <input type="hidden" name="service" value={s.id} />
                <Button type="submit" size="sm">Test now</Button>
              </form>
            </div>
          </Panel>

          <Panel icon={Power} tone="slate" title="On or off" description={s.killable ? "Switch it off when it misbehaves or costs too much. Clients see “temporarily unavailable”." : "This service cannot be switched off."} action={s.enabled ? <StatusPill tone="good" dot>On</StatusPill> : <StatusPill tone="new" dot>Off</StatusPill>}>
            <p className="rounded-2xl bg-soft px-4 py-3 text-[14px]">
              <strong>If off:</strong> {s.whenOff}
            </p>
            {!s.enabled && (
              <p className="text-[14px]">
                Off since {s.disabledAt ? dateTime(s.disabledAt) : "an unknown time"}
                {s.disabledBy ? ` by ${s.disabledBy}` : ""}
                {s.disabledReason ? `: ${s.disabledReason}` : "."}
              </p>
            )}
            {s.killable && (
              <div>
                {s.enabled ? (
                  <ConfirmButton action={setServiceEnabledHereAction} fields={{ service: s.id, enabled: "0" }} label="Switch off" title={`Switch off ${s.name}?`} description={`${s.whenOff} Clients see “temporarily unavailable”. The switch is written to the audit log.`} confirmLabel="Switch off">
                    <Field label="Reason" required>
                      <Input name="reason" minLength={3} maxLength={200} required />
                    </Field>
                  </ConfirmButton>
                ) : (
                  <form action={setServiceEnabledHereAction}>
                    <input type="hidden" name="service" value={s.id} />
                    <input type="hidden" name="enabled" value="1" />
                    <Button type="submit" size="sm">Switch on</Button>
                  </form>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel icon={TriangleAlert} tone={s.lastError ? "red" : "slate"} title="Last error" description="The newest error this service gave, from the error log.">
          {s.lastError ? (
            <div className="flex flex-col gap-1 text-[14px]">
              <p className="break-words text-danger">{s.lastError.message}</p>
              <p className="text-[12.5px] text-muted">
                {dateTime(s.lastError.at)} · <code className="font-mono">{s.lastError.source}</code>
              </p>
            </div>
          ) : (
            <EmptyState tone="good" title="No error recorded." />
          )}
        </Panel>
        {(s.usage.length > 0 || s.features.length > 0) && (
          <Panel title="Use" description="What it does in BuPulse and how much it was used.">
            {s.usage.length > 0 && (
              <dl className="grid grid-cols-2 gap-2">
                {s.usage.map((u) => (
                  <div key={u.label} className="rounded-2xl bg-soft px-4 py-3">
                    <dt className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{u.label}</dt>
                    <dd className="text-[17px] font-bold tabular-nums">{u.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {s.features.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {s.features.map((f) => (
                  <li key={f}>
                    <StatusPill tone="info">{f}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
