"use client";

import { Flag } from "lucide-react";
import { useState, type FormEvent } from "react";
import { reportCreatorAction } from "@/app/dashboard/creators/actions";
import { Button, Dialog, Field, Select, Textarea, useToast } from "@/components/ui";
import { CREATOR_REPORT_REASONS, REPORT_REASON_LABEL } from "@/lib/creators/report-reasons";

/** Report a creator to BuPulse: a reason and what happened. BuPulse reads it in the admin console. */
export function ReportCreator({ profileId, name }: { profileId: string; name: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(CREATOR_REPORT_REASONS[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await reportCreatorAction(profileId, reason, details);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    setDetails("");
    toast("Thank you. BuPulse will look into it.", "success");
  }

  return (
    <>
      <Button size="sm" variant="ghost" leading={<Flag aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        Report
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={`Report ${name}?`} description="BuPulse reads every report and can block a creator from the marketplace. They are not told who reported them.">
        <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
          <Field label="What is wrong?" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {CREATOR_REPORT_REASONS.map((r) => (
                <option key={r} value={r}>{REPORT_REASON_LABEL[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="What happened?" required={reason === "OTHER"} hint="A few words help: which posts, what you saw.">
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4} maxLength={2000} />
          </Field>
          {error && (
            <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[15px] font-medium text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send report"}</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
