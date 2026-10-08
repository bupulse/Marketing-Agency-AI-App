"use client";

import { Check, Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { rotateSecret, saveToggles, saveWebhookUrl, testWebhook } from "@/app/dashboard/leads/actions";
import { Switch } from "@/components/autopilot/switch";
import { Badge, Button, GlassCard, Input, useToast } from "@/components/ui";

export type NotificationsCardProps = {
  initial: { notifyInstant: boolean; notifyDaily: boolean; webhookUrl: string | null; hasWebhookSecret: boolean };
  email: string;
};

function ToggleRow({ title, text, checked, disabled, onChange }: { title: string; text: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-semibold">{title}</p>
        <p className="text-[14px] text-muted">{text}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

/** Owner alerts: instant email, daily summary and the signed lead.created webhook. */
export function NotificationsCard({ initial, email }: NotificationsCardProps) {
  const { toast } = useToast();
  const [toggles, setToggles] = useState({ notifyInstant: initial.notifyInstant, notifyDaily: initial.notifyDaily });
  const [url, setUrl] = useState(initial.webhookUrl ?? "");
  const [savedUrl, setSavedUrl] = useState(initial.webhookUrl ?? "");
  const [hasSecret, setHasSecret] = useState(initial.hasWebhookSecret);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function setToggle(key: "notifyInstant" | "notifyDaily", value: boolean) {
    const next = { ...toggles, [key]: value };
    const before = toggles;
    setToggles(next);
    start(async () => {
      const result = await saveToggles(next);
      if (result.ok) toast("Saved.", "success");
      else {
        setToggles(before);
        toast(result.error, "error");
      }
    });
  }

  function saveUrl() {
    setError(null);
    setTestResult(null);
    start(async () => {
      const result = await saveWebhookUrl(url);
      if (!result.ok) return setError(result.error);
      setSavedUrl(url.trim());
      setUrl(url.trim());
      setHasSecret(Boolean(url.trim()));
      setSecret(result.secret);
      toast(url.trim() ? "Webhook saved." : "Webhook removed.", "success");
    });
  }

  function rotate() {
    if (!window.confirm("Make a new secret? The old one stops working right away.")) return;
    start(async () => {
      const result = await rotateSecret();
      if (result.ok) {
        setSecret(result.secret);
        toast("New secret made.", "success");
      } else setError(result.error);
    });
  }

  function test() {
    setTestResult(null);
    start(async () => {
      const result = await testWebhook();
      if (!result.ok) return setTestResult({ ok: false, text: result.error });
      setTestResult(
        result.delivered
          ? { ok: true, text: `Delivered (${result.status}).` }
          : { ok: false, text: `Failed: ${result.detail ?? "no answer"}` },
      );
    });
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Select the secret and copy it by hand.", "info");
    }
  }

  const dirty = url.trim() !== savedUrl;

  return (
    <GlassCard as="section" aria-labelledby="lead-notifications" className="flex flex-col gap-2 p-5 sm:p-6">
      <h2 id="lead-notifications" className="text-lg font-semibold tracking-[-0.02em]">
        Notifications
      </h2>
      <p className="text-[14px] text-muted">Emails go to {email}.</p>
      <div className="divide-y divide-line">
        <ToggleRow title="Email me for every new lead" text="An email within seconds, with the contact details and the last chat messages." checked={toggles.notifyInstant} disabled={pending} onChange={(v) => setToggle("notifyInstant", v)} />
        <ToggleRow title="Daily summary" text="About 8:00 in the morning (your time zone): new leads from the last 24 hours and how many still wait for a reply. Not sent on quiet days." checked={toggles.notifyDaily} disabled={pending} onChange={(v) => setToggle("notifyDaily", v)} />
      </div>

      <div className="flex flex-col gap-3 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Webhook</h3>
          <Badge tone={savedUrl ? "success" : "neutral"}>{savedUrl ? "On" : "Off"}</Badge>
        </div>
        <p className="text-[14px] text-muted">
          Send each new lead to Zapier, Make or your own system. We POST JSON (<code>lead.created</code>) with the header <code>X-BuPulse-Signature: t=&lt;time&gt;,v1=&lt;hex&gt;</code>, an HMAC-SHA256 of <code>{"{t}.{body}"}</code> made with your secret. Only https addresses are allowed.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveUrl();
          }}
        >
          <div className="min-w-0 flex-1 basis-64">
            <Input type="url" inputMode="url" aria-label="Webhook address" placeholder="https://hooks.zapier.com/…" value={url} onChange={(e) => setUrl(e.target.value)} invalid={Boolean(error)} autoCapitalize="none" autoCorrect="off" />
          </div>
          <Button type="submit" disabled={pending || !dirty}>
            Save
          </Button>
          {savedUrl && !dirty && (
            <Button variant="outline" onClick={test} disabled={pending}>
              Send test
            </Button>
          )}
        </form>
        {error && (
          <p role="alert" className="text-[13px] font-medium text-danger">
            {error}
          </p>
        )}
        {testResult && (
          <p role="status" className={`text-[13px] font-medium ${testResult.ok ? "text-success" : "text-danger"}`}>
            {testResult.text}
          </p>
        )}
        {secret && (
          <div className="flex flex-col gap-2 rounded-2xl bg-soft p-4">
            <p className="text-[14px] font-semibold">Your signing secret. Copy it now: it is not shown again.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-xl bg-surface px-3 py-2 text-[13px] select-all">{secret}</code>
              <Button variant="outline" size="sm" onClick={() => void copy()} leading={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
        {hasSecret && savedUrl && !secret && (
          <p className="text-[13px] text-muted">
            The secret is stored encrypted and cannot be shown again.{" "}
            <button type="button" onClick={rotate} className="cursor-pointer font-medium text-pulse-blue hover:underline">
              Make a new one
            </button>
          </p>
        )}
      </div>
    </GlassCard>
  );
}
