"use client";

import { Check } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { connectReminderAction, type ReminderState } from "@/app/dashboard/connections/actions";
import { Button, buttonClasses, Dialog, Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NetworkIcon } from "./network-icon";
import { automaticAvailable, connectHref, primaryVariant, showFacebookLink, type ChannelInfo } from "./types";

// BuPulse-Socials: the sign-in page is Composio's, so say who that is before the person sees its name.
const COMPOSIO_NOTE = "You sign in on a secure page from Composio, the partner BuPulse uses to connect social accounts. We never see your password.";

const PROFESSIONAL = ["Posts automatically at the time you choose", "Photos and carousels of up to 10 images", "Reach, likes and saves in your reports", "For Business and Creator accounts"];
const PERSONAL = ["We remind you when it is time to post", "Caption and photos ready to copy", "No Instagram login needed", "You press post in the Instagram app"];

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2 text-sm text-muted">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function ChoiceCard({ selected, onSelect, title, badge, disabled, children }: { selected: boolean; onSelect: () => void; title: string; badge?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onSelect}
      className={cn(
        disabled && "!cursor-not-allowed opacity-60 hover:!bg-transparent",
        "flex w-full cursor-pointer flex-col rounded-2xl border-2 p-4 text-left transition-[border-color,background-color,box-shadow] duration-300 ease-out-soft motion-reduce:transition-none",
        selected ? "border-pulse-blue bg-ok-bg/40 shadow-glass" : "border-line bg-transparent hover:bg-soft",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span aria-hidden className={cn("flex size-5 items-center justify-center rounded-full border-2 transition-colors duration-300", selected ? "border-pulse-blue bg-pulse-blue" : "border-line")}>
          {selected && <span className="size-1.5 rounded-full bg-white" />}
        </span>
      </span>
      {badge && <span className="mt-1 text-xs font-semibold text-pulse-blue">{badge}</span>}
      {children}
    </button>
  );
}

function ReminderForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState<ReminderState, FormData>(connectReminderAction, {});
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  return (
    <form action={action} className="mt-5 flex animate-pop flex-col gap-4">
      <Field label="Instagram username" error={state.error}>
        <Input name="handle" placeholder="@yourshop" autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Name to show (optional)">
        <Input name="displayName" placeholder="Your Shop" maxLength={60} />
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Adding..." : "Add personal Instagram"}
      </Button>
    </form>
  );
}

function InstagramBody({ channel, onDone }: { channel: ChannelInfo; onDone: () => void }) {
  // Without Meta app keys automatic posting is not available yet; Personal (reminders) still works.
  const automatic = automaticAvailable(channel);
  const viaFacebookOnly = automatic && !channel.configured;
  const [kind, setKind] = useState<"professional" | "personal">(automatic ? "professional" : "personal");
  return (
    <>
      <div role="radiogroup" aria-label="Account type" className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard selected={kind === "professional"} onSelect={() => setKind("professional")} title="Professional" badge={automatic ? "Business and Creator, automatic posting" : "Coming soon — automatic posting is being approved by Meta"} disabled={!automatic}>
          <Checklist items={PROFESSIONAL} />
          {viaFacebookOnly && (
            <p className="mt-3 text-sm text-muted">
              Log in with Facebook and choose your Instagram account. It must be a Business or Creator account linked to a Facebook Page.
            </p>
          )}
        </ChoiceCard>
        <ChoiceCard selected={kind === "personal"} onSelect={() => setKind("personal")} title="Personal" badge="Reminder posting">
          <Checklist items={PERSONAL} />
        </ChoiceCard>
      </div>
      {kind === "professional" && automatic ? (
        <div className="mt-5 flex animate-pop flex-col items-stretch gap-3">
          <a href={connectHref("instagram", primaryVariant(channel))} className={buttonClasses({ size: "lg", className: "w-full" })}>
            {viaFacebookOnly ? "Continue with Facebook" : "Connect Instagram"}
          </a>
          {channel.viaComposio ? (
            <p className="text-center text-xs text-muted">
              {COMPOSIO_NOTE} It must be a Business or Creator account.
            </p>
          ) : viaFacebookOnly ? (
            <p className="text-center text-xs text-muted">
              Not linked yet? In the Instagram app open your profile settings, choose Business tools (or Account type and tools), and connect your Facebook Page.
            </p>
          ) : showFacebookLink(channel) ? (
            <a href={connectHref("instagram", "facebook")} className="min-h-11 py-3 text-center text-sm font-semibold text-pulse-blue underline-offset-4 hover:underline">
              Connect Instagram through Facebook
            </a>
          ) : (
            <p className="py-3 text-center text-sm text-muted">Connect through Facebook: coming soon</p>
          )}
        </div>
      ) : (
        <ReminderForm onDone={onDone} />
      )}
    </>
  );
}

/** The Connect modal. Instagram asks Professional or Personal; other networks get one simple card. */
export function ConnectDialog({ channel, onClose }: { channel: ChannelInfo; onClose: () => void }) {
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <Dialog open onOpenChange={close} title={`Connect ${channel.label}`} description={channel.network === "instagram" ? "Choose how you want to post to Instagram." : channel.note} className="max-w-xl">
      {channel.network === "instagram" ? (
        <InstagramBody channel={channel} onDone={onClose} />
      ) : (
        <div className="flex flex-col items-center gap-5 py-2 text-center">
          <NetworkIcon network={channel.network} className="size-14" />
          <p className="max-w-sm text-[15px] text-muted">
            {channel.viaComposio ? `You will sign in to ${channel.label} and choose what BuPulse may post to. ${COMPOSIO_NOTE}` : `You will sign in on ${channel.label} and choose what BuPulse may post to. We never see your password.`}
          </p>
          <a href={connectHref(channel.network)} className={buttonClasses({ size: "lg", className: "w-full" })}>
            Connect {channel.label}
          </a>
        </div>
      )}
    </Dialog>
  );
}
