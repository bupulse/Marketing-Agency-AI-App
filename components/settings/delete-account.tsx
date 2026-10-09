"use client";

import { useActionState, useState } from "react";
import { Button, Dialog, Field, GlassCard, Input } from "@/components/ui";
import { scheduleAccountDeletion, type SettingsState } from "@/app/dashboard/settings/actions";

const ERASED = ["your account", "your business and brand", "all content and designs", "uploaded files", "connections", "leads"];

/** Danger zone: deleting starts a 30-day grace period; the account is erased after it unless the owner cancels. */
export function DeleteAccount({ email, wholeCompany = false, teammates = 0 }: { email: string; wholeCompany?: boolean; teammates?: number }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(scheduleAccountDeletion, {});
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <GlassCard as="section" aria-labelledby="danger" className="flex flex-col gap-4 border border-danger/30 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="danger" className="text-lg font-semibold text-danger">
          Delete account
        </h2>
        <p className="text-sm text-muted">
          {wholeCompany
            ? "As the owner, this deletes the whole company. It is locked straight away and permanently erased after 30 days. Sign in any time before then to keep it."
            : "Your sign-in is removed from the company after 30 days. The company and its content stay with your teammates. Sign in any time before then to keep it."}
        </p>
      </div>
      <p className="text-sm text-muted">{wholeCompany ? `Erased for good: ${ERASED.join(", ")}.` : "Erased for good: your sign-in and your profile. Nothing your company created is deleted."}</p>
      {wholeCompany && teammates > 0 && (
        <p role="note" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
          {teammates} {teammates === 1 ? "teammate" : "teammates"} will lose access and everything they worked on. To keep the company, transfer ownership
          first in Settings, then Team.
        </p>
      )}
      <div>
        <Button variant="outline" className="border-danger/40 text-danger" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={wholeCompany ? "Delete the whole company?" : "Delete your account?"}
        description="You have 30 days to change your mind. After that everything is erased and cannot be recovered. A paid plan is cancelled now, so you will not be charged again; it stays usable until its period ends."
      >
        <form action={formAction} noValidate className="flex flex-col gap-4">
          <Field label={`Type ${email} to confirm`} required error={state.fieldErrors?.confirmEmail}>
            <Input
              name="confirmEmail"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          {wholeCompany && teammates > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="deleteCompany" className="mt-1 size-4" />
              <span>I understand this deletes the company for all {teammates + 1} users.</span>
            </label>
          )}
          {state.error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
            <Button type="submit" disabled={!matches || pending} className="bg-danger bg-none text-white shadow-none">
              {pending ? "Deleting…" : "Delete in 30 days"}
            </Button>
          </div>
        </form>
      </Dialog>
    </GlassCard>
  );
}
