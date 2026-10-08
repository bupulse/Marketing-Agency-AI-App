"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import type { CodeState } from "./actions";

/** The six-digit field shared by setup and verify. */
export function CodeForm({
  action,
  label,
  factorId,
  digits = 6,
}: {
  action: (prev: CodeState, formData: FormData) => Promise<CodeState>;
  label: string;
  factorId?: string;
  /** 6 for authenticator apps; the emailed code has 8. */
  digits?: number;
}) {
  const [state, formAction, pending] = useActionState<CodeState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {factorId && <input type="hidden" name="factorId" value={factorId} />}
      <Field label={`${digits}-digit code`} error={state.error}>
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`[0-9]{${digits}}`}
          maxLength={digits}
          placeholder={"123456789".slice(0, digits)}
          autoFocus
          className="text-center text-2xl tracking-[0.4em] tabular-nums"
        />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : label}
      </Button>
    </form>
  );
}
