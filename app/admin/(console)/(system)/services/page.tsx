import { Fragment } from "react";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { dateTime, param } from "@/lib/admin/format";
import { listServicesWithKeys, type EnvState, type ServiceView } from "@/lib/admin/services";
import type { CustomKeyView } from "@/lib/admin/service-keys";
import { isSecretName } from "@/lib/admin/service-keys-rules";
import { robotStatus } from "@/lib/visuals/robot";
import { inboxAdminView } from "@/lib/social/inbox/admin";
import { SocialInboxPanel } from "@/components/admin/social-inbox-panel";
import { setServiceEnabledAction, testServiceAction } from "@/app/admin/(console)/actions";
import { removeCustomKeyAction, removeServiceKeyAction, saveCustomKeyAction, saveServiceKeyAction } from "./actions";

export const metadata = { title: "Services" };

const HEALTH: Record<ServiceView["health"], { label: string; tone: "success" | "danger" | "violet" | "neutral" }> = {
  ok: { label: "Working", tone: "success" },
  down: { label: "Down", tone: "danger" },
  missing: { label: "Key missing", tone: "danger" },
  not_connected: { label: "Not connected", tone: "neutral" },
  off: { label: "Switched off", tone: "violet" },
  untested: { label: "Not tested yet", tone: "neutral" },
  not_in_use: { label: "Not in use", tone: "neutral" },
};

export default async function ServicesPage({ searchParams }: PageProps<"/admin/services">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [{ services, custom, unreadable }, robot, inbox] = await Promise.all([listServicesWithKeys(), robotStatus(), inboxAdminView()]);
  return (
    <>
      <PageHeader
        title="Services"
        description="Every outside service BuPulse relies on. Add or replace a key on its card: it is saved encrypted and used everywhere within 30 seconds, with no redeploy. Keys set in the hosting environment keep working; one saved here takes their place. A saved key is never shown again, only its last 4 characters."
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {unreadable.length > 0 && (
        <p role="alert" className={notice.bad}>
          Some saved keys could not be read, so they are not in use: {unreadable.join(", ")}. This happens when ENCRYPTION_KEY changes. Save them again below.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {services.map((s) => {
          const h = HEALTH[s.health];
          return (
            <Panel
              key={s.id}
              title={s.name}
              description={s.purpose}
              action={
                <span className="flex items-center gap-3">
                  <Badge tone={h.tone}>{h.label}</Badge>
                  {(s.health === "not_connected" || s.health === "missing") && <a href={`#setup-${s.id}`} className="text-sm font-medium underline">Set up</a>}
                </span>
              }
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                <dt className="text-muted">Keys</dt>
                <dd id={`setup-${s.id}`} className="scroll-mt-24">
                  <ServiceKeys s={s} />
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
        <SocialInboxPanel view={inbox} />
        <CustomKeys custom={custom} />
        <Panel
          title="Video robot"
          description="Makes content videos automatically on GitHub Actions every 15 minutes, in headless Chrome with the same renderer as the browser (docs/VIDEO_ROBOT.md)."
          action={<Badge tone={!robot.enabled ? "neutral" : robot.lastOk === false ? "danger" : robot.lastRunAt ? "success" : "neutral"}>{!robot.enabled ? "Not set up" : robot.lastOk === false ? "Last run failed" : robot.lastRunAt ? "Working" : "No run yet"}</Badge>}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
            <dt className="text-muted">Keys</dt>
            <dd><code className="font-mono text-[12px]">VIDEO_ROBOT_SECRET</code> <span className={robot.enabled ? "text-success" : "text-danger"}>{robot.enabled ? "set" : "missing"}</span></dd>
            <dt className="text-muted">Last run</dt>
            <dd>{robot.lastRunAt ? dateTime(robot.lastRunAt) : "Never"}</dd>
            <dt className="text-muted">Last 24 hours</dt>
            <dd>{robot.made24h} made, {robot.failed24h} failed, {robot.runs24h} runs</dd>
            <dt className="text-muted">Waiting</dt>
            <dd>{robot.waiting} videos{robot.needsBrowser > 0 ? `, ${robot.needsBrowser} left to the owner's browser after 3 failed tries` : ""}</dd>
            <dt className="text-muted">If off</dt>
            <dd className="text-muted">Owners make videos in their browser when they open the post, as before.</dd>
          </dl>
        </Panel>
      </div>
    </>
  );
}

// ---- keys ----------------------------------------------------------------------------------------------------

function KeyState({ e, missingIsBad }: { e: EnvState; missingIsBad: boolean }) {
  if (e.source === "saved") {
    return (
      <span>
        <span className="text-success">saved here</span>
        <span className="text-muted">
          {isSecretName(e.name) ? ` (ends ${e.shown})` : `: ${e.shown}`}
          {e.hostSet ? ", used instead of the hosting value" : ""}
        </span>
      </span>
    );
  }
  if (e.source === "host") return <span><span className="text-success">set</span> <span className="text-muted">(hosting environment)</span></span>;
  return <span className={missingIsBad ? "text-danger" : "text-muted"}>not set</span>;
}

function KeyButtons({ s, e }: { s: ServiceView; e: EnvState }) {
  const secret = isSecretName(e.name);
  const saved = e.source === "saved";
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <ConfirmButton
        action={saveServiceKeyAction}
        fields={{ name: e.name }}
        label={saved || e.source === "host" ? "Replace" : secret ? "Add key" : "Set"}
        title={`${saved || e.source === "host" ? "Replace" : "Add"} ${e.name}`}
        description={`For ${s.name}. Saved encrypted and used everywhere within 30 seconds, no redeploy needed.${e.hostSet ? " While it is saved here it is used instead of the value in the hosting environment." : ""}${secret ? " After saving, only its last 4 characters are shown." : ""} The change is written to the audit log.`}
        confirmLabel="Save"
        pendingLabel="Saving…"
      >
        <Field label={secret ? "Key" : "Value"} required hint={secret ? "Paste the whole key from the service's dashboard." : undefined}>
          <Input name="value" type={secret ? "password" : "text"} autoComplete="off" spellCheck={false} maxLength={4000} required />
        </Field>
      </ConfirmButton>
      {saved && (
        <ConfirmButton
          action={removeServiceKeyAction}
          fields={{ name: e.name }}
          label="Remove"
          title={`Remove the saved ${e.name}?`}
          description={e.hostSet ? "The value in the hosting environment is used again." : `It is not set anywhere else, so ${s.name} stops working until a key is added again.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
        />
      )}
    </span>
  );
}

function KeyLine({ s, e, missingIsBad }: { s: ServiceView; e: EnvState; missingIsBad: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
      <code className="font-mono text-[12px]">{e.name}</code>
      <KeyState e={e} missingIsBad={missingIsBad} />
      {s.keysWhere === "here" && <KeyButtons s={s} e={e} />}
    </span>
  );
}

function ServiceKeys({ s }: { s: ServiceView }) {
  if (s.env.length === 0 && s.optionalEnv.length === 0) return <>None needed</>;
  const notSetUp = s.health === "not_connected" || s.health === "missing";
  return (
    <>
      {s.env.map((e) => <KeyLine key={e.name} s={s} e={e} missingIsBad={s.health === "missing"} />)}
      {s.keysWhere === "settings" && (
        <span className="block text-xs text-muted">
          Enter Paddle&apos;s keys in <a href="/admin/settings#paddle" className="underline">Settings, Card payments</a>: that form checks they match the sandbox or live account.
        </span>
      )}
      {s.keysWhere === "host" && <span className="block text-xs text-muted">Set only in the hosting environment: BuPulse needs these to start, before it can read anything saved here.</span>}
      {notSetUp && s.keysWhere === "here" && (
        <span className="block text-xs text-muted">To set it up, add {s.env.filter((e) => !e.set).map((e) => e.name).join(", ")} here (or in the hosting environment), then press Test now.</span>
      )}
      {s.optionalEnv.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted">Optional settings ({s.optionalEnv.filter((e) => e.set).length} of {s.optionalEnv.length} set)</summary>
          {s.optionalEnv.map((e) => <KeyLine key={e.name} s={s} e={e} missingIsBad={false} />)}
        </details>
      )}
    </>
  );
}

function CustomKeyFields({ k }: { k?: CustomKeyView }) {
  return (
    <>
      <Field label="Name" required hint="What the key is for, for example Seedream images.">
        <Input name="label" defaultValue={k?.label} minLength={2} maxLength={80} required />
      </Field>
      {!k && (
        <Field label="Variable name" required hint="How code reads it: capital letters, digits and _, for example SEEDREAM_API_KEY. It cannot be changed later.">
          <Input name="envName" pattern="[A-Za-z][A-Za-z0-9_]{2,63}" maxLength={64} autoComplete="off" spellCheck={false} required />
        </Field>
      )}
      <Field label="Details" hint="Optional: which account it belongs to, its limits, who to ask.">
        <Textarea name="details" defaultValue={k?.details} maxLength={500} rows={3} />
      </Field>
      <Field label="Website" hint="Optional: the service's dashboard or docs.">
        <Input name="website" type="url" defaultValue={k?.website ?? undefined} maxLength={300} placeholder="https://" />
      </Field>
      <Field label={k ? "New value" : "Key"} required={!k} hint={k ? `Leave empty to keep the saved value (ends ${k.shown}).` : "Only its last 4 characters are shown after saving."}>
        <Input name="value" type="password" autoComplete="off" spellCheck={false} maxLength={4000} required={!k} />
      </Field>
    </>
  );
}

function CustomKeys({ custom }: { custom: CustomKeyView[] }) {
  return (
    <Panel
      title="Custom keys"
      description="Keys for any other service, for example an AI model you want to try. Saved encrypted like the others; code reads each one by its variable name. Nothing in BuPulse uses a custom key until a feature is built for it."
      action={
        <ConfirmButton
          action={saveCustomKeyAction}
          fields={{}}
          label="Add a custom key"
          title="Add a custom key"
          description="Saved encrypted and written to the audit log. It never replaces a variable the hosting environment already sets."
          confirmLabel="Save"
          pendingLabel="Saving…"
          variant="primary"
        >
          <CustomKeyFields />
        </ConfirmButton>
      }
    >
      {custom.length === 0 ? (
        <p className="text-[14px] text-muted">No custom keys yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {custom.map((k) => (
            <li key={k.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{k.label}</span>
                <code className="font-mono text-[12px]">{k.envName}</code>
                {k.inUse ? <Badge tone="success">Saved</Badge> : <Badge tone="danger">Not in use</Badge>}
              </span>
              {k.details && <span className="text-[14px] text-muted">{k.details}</span>}
              <span className="text-xs text-muted">
                Ends {k.shown} · saved {dateTime(k.savedAt)} by {k.savedBy}
                {k.website && (
                  <>
                    {" · "}
                    <a href={k.website} target="_blank" rel="noopener noreferrer" className="underline">
                      website
                    </a>
                  </>
                )}
              </span>
              {!k.inUse && <span className="text-xs text-danger">It could not be read, or the hosting environment now sets {k.envName}. Save a new value, or remove it.</span>}
              <span className="flex flex-wrap gap-1.5">
                <ConfirmButton action={saveCustomKeyAction} fields={{ id: k.id }} label="Edit" title={`Edit ${k.label}`} description={`Variable ${k.envName}. The change is written to the audit log.`} confirmLabel="Save" pendingLabel="Saving…">
                  <CustomKeyFields k={k} />
                </ConfirmButton>
                <ConfirmButton action={removeCustomKeyAction} fields={{ id: k.id }} label="Remove" title={`Remove ${k.label}?`} description={`Code reading ${k.envName} gets nothing from now on. This cannot be undone; you would paste the key again.`} confirmLabel="Remove" pendingLabel="Removing…" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
