"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { createLinkAction, type LinkActionState } from "@/app/support/(app)/links/actions";
import { CHANNELS, DESTINATIONS, shortLink } from "@/lib/links/rules";

/** Copies a short link; says "Copied" for two seconds. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          },
          () => undefined,
        )
      }
      className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-ok-bg"
      aria-label={`${label} ${text}`}
    >
      {done ? <Check aria-hidden className="size-4 text-ok" /> : <Copy aria-hidden className="size-4" />}
      {done ? "Copied" : label}
    </button>
  );
}

/** Name, where it is shared, the page it opens and (optional) the words after /go/. */
export function CreateLinkForm({ site, owner }: { site: string; owner: boolean }) {
  const [state, action, pending] = useActionState<LinkActionState, FormData>(createLinkAction, {});
  const [destination, setDestination] = useState<string>("/");
  const host = site.replace(/^https?:\/\//, "");
  return (
    <form action={action} className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">Make a link</h2>
        <p className="text-sm text-muted">
          {owner
            ? "Your links are the company's: put them on BuPulse's Instagram, Facebook, TikTok, LinkedIn and other pages."
            : "Give your link to clients. Everyone who comes through it, and everyone you talk to in the chat, is your lead."}
        </p>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Name (only you see it)">
          <Input name="label" required maxLength={80} placeholder={owner ? "Instagram bio" : "My WhatsApp status"} />
        </Field>
        <Field label="Where you will share it">
          <Select name="channel" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {CHANNELS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Page it opens">
          <Select name="destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
            {DESTINATIONS.map((d) => (
              <option key={d.path} value={d.path}>
                {d.label}
              </option>
            ))}
            <option value="other">Other page…</option>
          </Select>
        </Field>
        {destination === "other" ? (
          <Field label="Page of bupulse.com (starts with /)">
            <Input name="customPath" required placeholder="/pricing" maxLength={200} />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label={`Link words (optional): ${host}/go/…`} error={state.error}>
          <Input name="code" maxLength={40} placeholder="Left empty, we make one" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Making…" : "Make the link"}
        </Button>
        {state.created && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Ready: <strong className="break-all">{shortLink(site, state.created.code)}</strong>
            </span>
            <CopyButton text={shortLink(site, state.created.code)} />
          </p>
        )}
      </div>
    </form>
  );
}
