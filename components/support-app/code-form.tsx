"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";

type State = { error?: string };

/** The code field of the sign-in steps: 6 digits from the authenticator app, or the emailed code (8). */
export function SupportCodeForm({ action, label, factorId, digits = 6, fieldLabel }: { action: (prev: State, formData: FormData) => Promise<State>; label: string; factorId?: string; digits?: number; fieldLabel?: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {factorId && <input type="hidden" name="factorId" value={factorId} />}
      <Field label={fieldLabel ?? `${digits}-digit code`} error={state.error}>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern={`[0-9]{${digits}}`} maxLength={digits} placeholder={"123456789".slice(0, digits)} autoFocus className="text-center text-2xl tracking-[0.4em] tabular-nums" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : label}
      </Button>
    </form>
  );
}
