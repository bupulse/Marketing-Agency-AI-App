"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { checkInstallation, type CheckResult } from "@/app/dashboard/widget/check-action";
import { Button, Input } from "@/components/ui";

/** "Check installation": has the widget loaded on a website recently? */
export function InstallCheck() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [pending, start] = useTransition();

  function check() {
    start(async () => setResult(await checkInstallation(url)));
  }

  let line: { ok: boolean; text: string } | null = null;
  if (result?.ok === false) line = { ok: false, text: result.error };
  else if (result?.ok) {
    const r = result.result;
    if (r.status === "never") line = { ok: false, text: "Not seen yet. Add the code, open your website once, then check again." };
    else if (r.matches === false) line = { ok: false, text: `Seen on ${r.host} ${r.ago}, but not on ${result.typedHost}. Is the code on that page?` };
    else if (!r.recent) line = { ok: false, text: `Last seen on ${r.host} ${r.ago}. Not seen recently: open your website to refresh.` };
    else line = { ok: true, text: `Seen on ${r.host} ${r.ago}.` };
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-soft p-4">
      <div>
        <h3 className="text-[15px] font-semibold">Check installation</h3>
        <p className="text-[13px] text-muted">Open your website once after adding the code, then check here. You can type the page address to see if it matches.</p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <Input aria-label="Your page address" type="url" inputMode="url" placeholder="https://mysite.com (optional)" value={url} onChange={(e) => setUrl(e.target.value)} className="sm:flex-1" />
        <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Check installation"}</Button>
      </form>
      <div role="status" aria-live="polite">
        {line && (
          <p className={`flex items-start gap-2 text-[14px] ${line.ok ? "text-success" : "text-text"}`}>
            {line.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />}
            {line.text}
          </p>
        )}
      </div>
      <p className="text-[12.5px] text-muted">
        Nothing showing? Open your browser console (right-click the page → Inspect → Console) and look for a line starting with <code>[BuPulse chat] Not shown:</code>. It tells you why.
      </p>
    </div>
  );
}
