"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";

type CodeState = { error?: string };

/**
 * The code from a BuPulse email (sign-up confirmation or password reset), typed or pasted: works when the email is
 * opened on a phone and the site on a computer. Only digits are kept, so "123 456" or "123-456" paste fine.
 */
export function EmailCodeForm({
  action,
  email,
  next,
  submitLabel = "Confirm",
}: {
  action: (prev: CodeState, formData: FormData) => Promise<CodeState>;
  email: string;
  next?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<CodeState, FormData>(action, {});
  const [code, setCode] = useState("");

  return (
    <form action={formAction} noValidate className="flex w-full flex-col gap-3 text-left">
      <input type="hidden" name="email" value={email} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Code from the email" error={state.error}>
        <Input
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6,10}"
          placeholder="123456"
          className="text-center text-2xl tracking-[0.3em] tabular-nums"
        />
      </Field>
      <Button type="submit" disabled={pending || code.length < 6} className="w-full">
        {pending ? "Checking…" : submitLabel}
      </Button>
    </form>
  );
}
