"use client";

import { Flag } from "lucide-react";
import { useActionState } from "react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import type { ReportState } from "@/app/creator/(portal)/actions";

const initial: ReportState = { status: "idle" };

/**
 * "Report this campaign" for signed-in creators, on /c/<slug> and the portal's campaign page (`report`:
 * reportCampaignAction bound to the campaign). Folded until opened; BuPulse's team reads every report.
 */
export function ReportCampaign({ report, reasons }: { report: (prev: ReportState, form: FormData) => Promise<ReportState>; reasons: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(report, initial);
  if (state.status === "sent") {
    return (
      <p role="status" className="rounded-field bg-success-bg px-4 py-3 text-sm font-medium text-success">
        Thank you. BuPulse&apos;s team reads every report and acts on it.
      </p>
    );
  }
  return (
    <details className="group rounded-field" open={state.status === "error"}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted hover:text-text">
        <Flag aria-hidden className="size-4" /> Report this campaign
      </summary>
      <form action={action} className="mt-2 flex flex-col gap-4 rounded-field bg-soft p-4">
        <Field label="What is wrong?" required>
          <Select name="reason" defaultValue="">
            <option value="" disabled>
              Choose a reason
            </option>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tell us more" hint="What happened, and when. Needed for “Something else”.">
          <Textarea name="details" rows={3} maxLength={2000} />
        </Field>
        {state.error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={pending} className="self-start">
          {pending ? "Sending…" : "Send report"}
        </Button>
      </form>
    </details>
  );
}
