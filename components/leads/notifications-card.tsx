"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveToggles } from "@/app/dashboard/leads/actions";
import { Switch } from "@/components/autopilot/switch";
import { GlassCard, useToast } from "@/components/ui";

export type NotificationsCardProps = {
  initial: { notifyInstant: boolean; notifyDaily: boolean };
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

/** Owner alerts: instant email and daily summary. Webhooks live on Connectors > Webhooks. */
export function NotificationsCard({ initial, email }: NotificationsCardProps) {
  const { toast } = useToast();
  const [toggles, setToggles] = useState({ notifyInstant: initial.notifyInstant, notifyDaily: initial.notifyDaily });
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

      <p className="pt-3 text-[14px] text-muted">
        Want each new lead sent to Zapier, Make or your own system?{" "}
        <Link href="/dashboard/connectors/webhooks" className="font-medium text-pulse-blue hover:underline">
          Set up a webhook
        </Link>
        .
      </p>
    </GlassCard>
  );
}
