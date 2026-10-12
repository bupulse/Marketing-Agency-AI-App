"use client";

import { Plus, RotateCw } from "lucide-react";
import { useState, useTransition } from "react";
import {
  createWebhook,
  deleteWebhook,
  retryWebhookDelivery,
  rotateWebhookSecret,
  sendWebhookTest,
  toggleWebhook,
  updateWebhook,
} from "@/app/dashboard/connectors/webhooks/actions";
import { Badge, Button, Dialog, GlassCard, Input, useToast, type BadgeTone } from "@/components/ui";
import { SecretBox } from "./secret-box";
import { When } from "./when";
import { EVENT_LABELS, WEBHOOK_EVENTS } from "@/lib/webhooks/events";

export type EndpointView = { id: string; url: string; events: string[]; enabled: boolean; createdAt: string; lastSuccessAt: string | null; lastFailureAt: string | null; failureCount: number; pausedBySupport?: boolean };
export type DeliveryView = { id: string; endpointId: string; url: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; nextAttemptAt: string | null; createdAt: string };

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  success: { tone: "success", label: "Delivered" },
  pending: { tone: "violet", label: "Will retry" },
  failed: { tone: "danger", label: "Failed" },
};

function EndpointForm({ initial, submitLabel, pending, error, onSubmit, onCancel }: { initial: { url: string; events: string[] }; submitLabel: string; pending: boolean; error: string | null; onSubmit: (v: { url: string; events: string[] }) => void; onCancel: () => void }) {
  const [url, setUrl] = useState(initial.url);
  const [events, setEvents] = useState<string[]>(initial.events);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ url, events });
      }}
    >
      <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
        Address to send to
        <Input type="url" inputMode="url" placeholder="https://hooks.zapier.com/hooks/catch/…" value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="none" autoCorrect="off" invalid={Boolean(error)} required />
        <span className="text-[13px] font-normal text-muted">Must start with https://. Zapier &ldquo;Catch Hook&rdquo; and Make &ldquo;Custom webhook&rdquo; addresses work.</span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-semibold">Send me</legend>
        {WEBHOOK_EVENTS.map((event) => (
          <label key={event} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line px-3 py-2">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-[var(--color-pulse-blue)]"
              checked={events.includes(event)}
              onChange={(e) => setEvents(e.target.checked ? [...events, event] : events.filter((x) => x !== event))}
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">
                {EVENT_LABELS[event].label} <code className="text-[12px] font-normal text-muted">{event}</code>
              </span>
              <span className="block text-[13px] text-muted">{EVENT_LABELS[event].text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** `readOnly`: the plan no longer has webhooks. The endpoints stay to look at, switch off and delete; nothing else is offered. */
export function WebhooksManager({ endpoints, deliveries, max, readOnly = false }: { endpoints: EndpointView[]; deliveries: DeliveryView[]; max: number; readOnly?: boolean }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<null | { mode: "add" } | { mode: "edit"; endpoint: EndpointView }>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<EndpointView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  function submit(values: { url: string; events: string[] }) {
    setFormError(null);
    const editing = form?.mode === "edit" ? form.endpoint : null;
    start(async () => {
      const result = editing ? await updateWebhook(editing.id, values) : await createWebhook(values);
      if (!result.ok) return setFormError(result.error);
      setForm(null);
      const created = (result as { secret?: string }).secret;
      if (!editing && created) setSecret({ title: "Your signing secret. Copy it now: it is not shown again.", value: created });
      toast(editing ? "Webhook saved." : "Webhook added.", "success");
    });
  }

  function run(id: string, task: () => Promise<void>) {
    setBusyId(id);
    start(async () => {
      try {
        await task();
      } finally {
        setBusyId(null);
      }
    });
  }

  const test = (e: EndpointView) =>
    run(e.id, async () => {
      const r = await sendWebhookTest(e.id);
      const result = !r.ok ? { ok: false, text: r.error } : r.delivered ? { ok: true, text: `Test delivered${r.status ? ` (${r.status})` : ""}.` } : { ok: false, text: `Test failed: ${r.detail ?? "no answer"}` };
      setTestResult((prev) => ({ ...prev, [e.id]: result }));
    });

  const rotate = (e: EndpointView) =>
    run(e.id, async () => {
      const r = await rotateWebhookSecret(e.id);
      if (r.ok) setSecret({ title: "Your new signing secret. The old one no longer works. Copy it now: it is not shown again.", value: r.secret });
      else toast(r.error, "error");
    });

  const toggle = (e: EndpointView) =>
    run(e.id, async () => {
      const r = await toggleWebhook(e.id, !e.enabled);
      toast(r.ok ? (e.enabled ? "Webhook paused." : "Webhook on again.") : r.error, r.ok ? "success" : "error");
    });

  const retry = (d: DeliveryView) =>
    run(d.id, async () => {
      const r = await retryWebhookDelivery(d.id);
      if (!r.ok) toast(r.error, "error");
      else toast(r.delivered ? "Delivered." : `Still failing: ${r.detail ?? "no answer"}`, r.delivered ? "success" : "error");
    });

  return (
    <div className="flex flex-col gap-6">
      {secret && <SecretBox title={secret.title} value={secret.value} onDone={() => setSecret(null)} />}

      <section aria-labelledby="endpoints" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <h2 id="endpoints" className="text-lg font-semibold">
            Your webhooks
          </h2>
          {!readOnly && (
            <Button size="sm" onClick={() => { setFormError(null); setForm({ mode: "add" }); }} disabled={endpoints.length >= max} leading={<Plus aria-hidden className="size-4" />}>
              Add webhook
            </Button>
          )}
        </div>
        {endpoints.length === 0 ? (
          <GlassCard className="flex flex-col gap-2 rounded-card p-5">
            <p className="font-semibold">No webhooks yet</p>
            <p className="text-[14px] text-muted">Add the address Zapier or Make gave you, choose what to send, and every event arrives within seconds, signed so you know it is from BuPulse. Details are in docs/WEBHOOKS.md.</p>
          </GlassCard>
        ) : (
          <ul className="flex flex-col gap-3">
            {endpoints.map((e) => (
              <GlassCard as="li" key={e.id} className="flex flex-col gap-3 rounded-card p-5" data-endpoint={e.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-all font-semibold">{e.url}</p>
                  <Badge tone={e.pausedBySupport ? "danger" : e.enabled ? "success" : "neutral"}>{e.pausedBySupport ? "Paused by BuPulse support" : e.enabled ? "On" : "Paused"}</Badge>
                  {e.failureCount > 0 && <Badge tone="danger">{e.failureCount} failed in a row</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {e.events.map((ev) => (
                    <Badge key={ev} tone="blue">
                      {ev}
                    </Badge>
                  ))}
                </div>
                <p className="text-[13px] text-muted">
                  {e.lastSuccessAt ? <>Last delivered <When iso={e.lastSuccessAt} />.</> : "Nothing delivered yet."}
                  {e.lastFailureAt ? <> Last failure <When iso={e.lastFailureAt} />.</> : ""}
                </p>
                {e.pausedBySupport && (
                  <p role="status" className="rounded-2xl bg-soft p-3 text-[13px]">
                    <strong>Paused by BuPulse support.</strong> No events are sent until support turns it back on. <a href="/contact" className="underline">Contact support</a>.
                  </p>
                )}
                {testResult[e.id] && (
                  <p role="status" className={`text-[13px] font-medium ${testResult[e.id].ok ? "text-success" : "text-danger"}`}>
                    {testResult[e.id].text}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {!readOnly && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => test(e)} disabled={e.pausedBySupport || (pending && busyId === e.id)}>
                        Send test event
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => { setFormError(null); setForm({ mode: "edit", endpoint: e }); }}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => rotate(e)} disabled={pending && busyId === e.id}>
                        New secret
                      </Button>
                    </>
                  )}
                  {(!readOnly || e.enabled) && (
                    <Button variant="outline" size="sm" onClick={() => toggle(e)} disabled={e.pausedBySupport || (pending && busyId === e.id)}>
                      {e.enabled ? "Pause" : "Turn on"}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setRemoving(e)} aria-label={`Delete webhook ${host(e.url)}`}>
                    Delete
                  </Button>
                </div>
              </GlassCard>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="log" className="flex flex-col gap-3">
        <div className="px-1">
          <h2 id="log" className="text-lg font-semibold">
            Delivery log
          </h2>
          <p className="text-[14px] text-muted">The last 50 deliveries, kept for 30 days. Failed ones are tried again every hour for up to 24 hours.</p>
        </div>
        {deliveries.length === 0 ? (
          <GlassCard className="rounded-card p-5 text-[14px] text-muted">Deliveries will appear here.</GlassCard>
        ) : (
          <GlassCard padding="none" className="rounded-card">
            <ul className="divide-y divide-line">
              {deliveries.map((d) => {
                const s = STATUS[d.status] ?? STATUS.failed;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4" data-delivery={d.id} data-status={d.status}>
                    <div className="min-w-0 flex-1 basis-60">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-[13px] font-semibold">{d.event}</code>
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {d.responseStatus && <span className="text-[13px] text-muted">HTTP {d.responseStatus}</span>}
                      </div>
                      <p className="mt-1 text-[13px] break-words text-muted">
                        {host(d.url)} · <When iso={d.createdAt} /> · {d.attempts} {d.attempts === 1 ? "try" : "tries"}
                        {d.status === "pending" && d.nextAttemptAt ? <> · next try about <When iso={d.nextAttemptAt} /></> : ""}
                      </p>
                      {d.error && d.status !== "success" && <p className="mt-0.5 text-[13px] break-words text-danger">{d.error}</p>}
                    </div>
                    {d.status !== "success" && !readOnly && (
                      <Button variant="outline" size="sm" onClick={() => retry(d)} disabled={pending && busyId === d.id} leading={<RotateCw aria-hidden className="size-4" />}>
                        Retry
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </GlassCard>
        )}
      </section>

      {form && (
        <Dialog open onOpenChange={(o) => !o && setForm(null)} title={form.mode === "add" ? "Add a webhook" : "Edit webhook"} description="BuPulse sends a signed POST with JSON to this address.">
          <EndpointForm
            initial={form.mode === "edit" ? { url: form.endpoint.url, events: form.endpoint.events } : { url: "", events: ["lead.created"] }}
            submitLabel={form.mode === "add" ? "Add webhook" : "Save"}
            pending={pending}
            error={formError}
            onSubmit={submit}
            onCancel={() => setForm(null)}
          />
        </Dialog>
      )}
      {removing && (
        <Dialog open onOpenChange={(o) => !o && setRemoving(null)} title="Delete this webhook?" description={removing.url}>
          <p className="text-[15px] text-muted">BuPulse stops sending events to it and removes its delivery log.</p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              size="sm"
              disabled={pending}
              className="!bg-danger !bg-none !text-white !shadow-none"
              onClick={() =>
                start(async () => {
                  const r = await deleteWebhook(removing.id);
                  setRemoving(null);
                  toast(r.ok ? "Webhook deleted." : r.error, r.ok ? "success" : "error");
                })
              }
            >
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
