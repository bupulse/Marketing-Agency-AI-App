"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { createKeyAction, rotateKeyAction, type KeyState } from "@/app/admin/(console)/actions";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code aria-label={label} className="min-w-0 flex-1 select-all break-all rounded-xl bg-soft px-3 py-2.5 font-mono text-[13px]">
        {value}
      </code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        leading={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* Safari without permission: the text is selectable instead. */
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Secret({ state, onDone, doneLabel }: { state: KeyState; onDone?: () => void; doneLabel?: string }) {
  if (!state.key) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-2xl bg-success-bg p-4 text-sm">
      <p className="font-semibold text-success">Key “{state.name}” created. Copy it now: it is shown only once.</p>
      <CopyField value={state.key} label="New key" />
      {onDone && <Button type="button" size="sm" className="self-start" onClick={onDone}>{doneLabel ?? "I have copied it"}</Button>}
    </div>
  );
}

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<KeyState, FormData>(createKeyAction, {});
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Name"><Input name="name" defaultValue="Jarvis" maxLength={60} required /></Field>
        <Field label="Allowed IP addresses (optional)" hint="Separate with commas. Empty allows any address.">
          <Input name="ips" placeholder="203.0.113.7, 198.51.100.0/24" />
        </Field>
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create key"}</Button>
      </form>
      {state.error && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{state.error}</p>}
      <Secret state={state} />
    </div>
  );
}

export function RotateKey({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<KeyState, FormData>(rotateKeyAction, {});
  const [confirm, setConfirm] = useState(false);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-2">
      {!state.key && (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          {confirm ? (
            <>
              <span className="text-xs text-muted">The old key stops working now.</span>
              <Button type="submit" size="sm" disabled={pending}>{pending ? "Rotating…" : `Rotate ${name}`}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(true)}>Rotate</Button>
          )}
        </form>
      )}
      {state.error && <p role="alert" className="text-xs font-medium text-danger">{state.error}</p>}
      <Secret state={state} doneLabel="I have copied it, refresh the list" onDone={() => router.refresh()} />
      {state.key && <p className="text-xs text-muted">The old key is already revoked. Jarvis needs this new one.</p>}
    </div>
  );
}
