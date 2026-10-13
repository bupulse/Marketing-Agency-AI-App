"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button, Field, useToast } from "@/components/ui";
import { updatePassword, type ResetState } from "@/app/reset-password/actions";
import { PasswordChecks } from "./password-checks";
import { PasswordInput } from "./password-input";
import { useFieldErrors } from "./use-field-errors";

export default function ResetForm() {
  const [state, formAction, pending] = useActionState<ResetState, FormData>(updatePassword, {});
  const [password, setPassword] = useState("");
  const fields = useFieldErrors(state, state.fieldErrors);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!state.done) return;
    toast("Your password has been updated.", "success");
    router.replace("/dashboard");
  }, [state.done, router, toast]);

  return (
    <form action={formAction} noValidate onInput={fields.edit} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <Field label="New password" required error={fields.error("password")}>
        <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <PasswordChecks value={password} />
      <Field label="Confirm new password" required error={fields.error("confirmPassword")}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" />
      </Field>
      <Button type="submit" disabled={pending || state.done} className="w-full">
        {pending || state.done ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
