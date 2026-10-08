"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { connectCloudflareAction, type TokenState } from "@/app/dashboard/domains/actions";

export function TokenForm() {
  const [state, action, pending] = useActionState<TokenState, FormData>(connectCloudflareAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="cf-token" className="text-[14px] font-semibold">Paste your token</label>
      <Input id="cf-token" name="token" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={200} placeholder="Cloudflare API token" />
      {state.error && <p role="alert" className="text-[14px] text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Checking…" : "Connect Cloudflare"}</Button>
    </form>
  );
}
