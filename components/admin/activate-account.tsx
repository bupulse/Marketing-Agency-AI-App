"use client";

import { useState } from "react";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";
import { activateAccountAction } from "@/app/admin/(console)/(money)/invoices/actions";

/**
 * "Activate account" after the demo (Demos list and the company page's "Demo and trial" panel): start the trial for an
 * editable number of days, or skip the trial and open a draft invoice for the client's plan. The action re-checks the
 * admin (AAL2) and audits either choice.
 */
export function ActivateAccount({ businessId, back, businessName, planName, trialDays, interval }: { businessId: string; back: string; businessName: string; planName: string | null; trialDays: number; interval: "MONTH" | "YEAR" }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"trial" | "invoice">("trial");
  const plan = planName ? `the ${planName} plan` : "their chosen plan";
  return (
    <>
      <Button type="button" size="sm" variant="primary" onClick={() => setOpen(true)}>
        Activate account
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={`Activate ${businessName}?`} description="After the demo: start a trial, or skip it and send an invoice. Written to the audit log.">
        <form action={activateAccountAction} className="flex flex-col gap-4">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="mode" value={mode} />
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">How to activate</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 has-[:checked]:border-pulse-blue">
              <input type="radio" name="choice" value="trial" checked={mode === "trial"} onChange={() => setMode("trial")} className="mt-1 size-4" />
              <span className="flex flex-col gap-1">
                <strong className="text-[15px]">Start trial</strong>
                <span className="text-sm text-muted">The company gets {plan}&apos;s features with the trial limits, starting now. The client is emailed.</span>
              </span>
            </label>
            {mode === "trial" && (
              <Field label="Trial length (days)" hint="1 to 90. The default is the trial setting.">
                <Input name="days" type="number" min={1} max={90} step={1} defaultValue={trialDays} required className="w-28" />
              </Field>
            )}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 has-[:checked]:border-pulse-blue">
              <input type="radio" name="choice" value="invoice" checked={mode === "invoice"} onChange={() => setMode("invoice")} className="mt-1 size-4" />
              <span className="flex flex-col gap-1">
                <strong className="text-[15px]">No trial, send invoice</strong>
                <span className="text-sm text-muted">Creates a draft invoice for {plan} at the price of the company&apos;s region and opens it in the editor. Nothing is sent until you press Send.</span>
              </span>
            </label>
            {mode === "invoice" && (
              <Field label="Billed">
                <Select name="interval" defaultValue={interval}>
                  <option value="MONTH">Monthly</option>
                  <option value="YEAR">Yearly</option>
                </Select>
              </Field>
            )}
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{mode === "trial" ? "Start trial" : "Create invoice"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
