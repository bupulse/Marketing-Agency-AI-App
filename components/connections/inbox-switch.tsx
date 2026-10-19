"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/autopilot/switch";
import { setInboxEnabledAction } from "@/app/dashboard/connections/actions";
import type { InboxInfo } from "./types";

/** "Answer comments and messages" for one Instagram or Facebook account: its comments and DMs come into the inbox. */
export function InboxSwitch({ id, name, inbox }: { id: string; name: string; inbox: InboxInfo }) {
  const [checked, setChecked] = useState(inbox.enabled);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const change = (next: boolean) => {
    setChecked(next);
    setMessage(null);
    start(async () => {
      const result = await setInboxEnabledAction(id, next);
      if (!result.ok) setChecked(!next);
      setMessage({ ok: result.ok, text: result.message });
    });
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 pl-14">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-[14px] font-medium">Answer comments and messages</p>
        <p className="text-[13px] text-muted" aria-live="polite">
          {message?.text ?? inbox.note ?? "Bring this account's comments and DMs into your inbox so automations and your team can answer them."}
        </p>
      </div>
      <Switch checked={checked} onChange={change} label={`Answer comments and messages for ${name}`} disabled={pending || (!inbox.usable && !checked)} />
    </div>
  );
}
