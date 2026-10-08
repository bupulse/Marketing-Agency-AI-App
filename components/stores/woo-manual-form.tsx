"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { connectWooManualAction, type ManualState } from "@/app/dashboard/stores/actions";

/** Fallback for stores that block the one-click page: paste the REST API keys (WooCommerce > Settings > Advanced > REST API). */
export function WooManualForm() {
  const [state, action, pending] = useActionState<ManualState, FormData>(connectWooManualAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Store address">
        <Input name="store" type="url" inputMode="url" placeholder="https://yourstore.com" autoComplete="off" defaultValue={state.values?.store} required />
      </Field>
      <Field label="Consumer key" hint="Starts with ck_">
        <Input name="key" autoComplete="off" autoCapitalize="none" spellCheck={false} defaultValue={state.values?.key} required />
      </Field>
      <Field label="Consumer secret" hint="Starts with cs_">
        <Input name="secret" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
      </Field>
      {state.error && <p role="alert" className="text-[14px] text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Checking…" : "Connect with these keys"}</Button>
    </form>
  );
}
