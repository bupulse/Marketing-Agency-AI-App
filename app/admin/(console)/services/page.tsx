import { Fragment } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input } from "@/components/ui";
import { dateTime, param } from "@/lib/admin/format";
import { listServices, type ServiceView } from "@/lib/admin/services";
import { setServiceEnabledAction, testServiceAction } from "../actions";

export const metadata = { title: "Services" };

const HEALTH: Record<ServiceView["health"], { label: string; tone: "success" | "danger" | "violet" | "neutral" }> = {
  ok: { label: "Working", tone: "success" },
  down: { label: "Down", tone: "danger" },
  missing: { label: "Key missing", tone: "danger" },
  off: { label: "Switched off", tone: "violet" },
  untested: { label: "Not tested yet", tone: "neutral" },
  not_in_use: { label: "Not in use", tone: "neutral" },
};

export default async function ServicesPage({ searchParams }: PageProps<"/admin/services">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const services = await listServices();
  return (
    <>
      <PageHeader title="Services" description="Every outside service BuPulse relies on. Keys live in the Cloudflare environment; this page only shows whether each one is set, never the value." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {services.map((s) => {
          const h = HEALTH[s.health];
          return (
            <Panel key={s.id} title={s.name} description={s.purpose} action={<Badge tone={h.tone}>{h.label}</Badge>}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                <dt className="text-muted">Keys</dt>
                <dd>
                  {s.env.length === 0 ? "None needed" : s.env.map((e) => (<span key={e.name} className="mr-2 inline-block"><code className="font-mono text-[12px]">{e.name}</code> <span className={e.set ? "text-success" : "text-danger"}>{e.set ? "set" : "missing"}</span></span>))}
                  {s.optionalEnv.length > 0 && <span className="block text-xs text-muted">Optional: {s.optionalEnv.map((e) => `${e.name} (${e.set ? "set" : "not set"})`).join(", ")}</span>}
                </dd>
                <dt className="text-muted">Last test</dt>
                <dd>{s.lastCheck ? <>{s.lastCheck.ok ? "Passed" : "Failed"}, {s.lastCheck.latencyMs} ms, {dateTime(s.lastCheck.checkedAt)}{s.lastCheck.message ? <span className="block text-xs text-muted">{s.lastCheck.message}</span> : null}</> : "Never"}</dd>
                <dt className="text-muted">Last error</dt>
                <dd>{s.lastError ? <><span className="block break-words text-danger">{s.lastError.message}</span><span className="text-xs text-muted">{dateTime(s.lastError.at)} · {s.lastError.source}</span></> : "None recorded"}</dd>
                {s.usage.map((u) => (<Fragment key={u.label}><dt className="text-muted">{u.label}</dt><dd>{u.value}</dd></Fragment>))}
                <dt className="text-muted">If off</dt><dd className="text-muted">{s.whenOff}</dd>
                {!s.enabled && (<><dt className="text-muted">Off since</dt><dd>{s.disabledAt ? dateTime(s.disabledAt) : "n/a"}{s.disabledReason ? `: ${s.disabledReason}` : ""}</dd></>)}
              </dl>
              <div className="flex flex-wrap gap-2">
                <form action={testServiceAction}><input type="hidden" name="service" value={s.id} /><Button type="submit" size="sm" variant="outline">Test now</Button></form>
                {s.killable && (s.enabled ? (
                  <ConfirmButton action={setServiceEnabledAction} fields={{ service: s.id, enabled: "0" }} label="Switch off" title={`Switch off ${s.name}?`} description={`${s.whenOff} Clients see “temporarily unavailable”. The switch is written to the audit log.`} confirmLabel="Switch off">
                    <Field label="Reason" required><Input name="reason" minLength={3} maxLength={200} required /></Field>
                  </ConfirmButton>
                ) : (
                  <form action={setServiceEnabledAction}><input type="hidden" name="service" value={s.id} /><input type="hidden" name="enabled" value="1" /><Button type="submit" size="sm">Switch on</Button></form>
                ))}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
