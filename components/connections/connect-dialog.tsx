"use client";

import { Check } from "lucide-react";
import { buttonClasses, Dialog } from "@/components/ui";
import { NetworkIcon } from "./network-icon";
import { connectHref, primaryVariant, showFacebookLink, type ChannelInfo } from "./types";

// BuPulse-Socials: the sign-in page is Composio's, so say who that is before the person sees its name.
const COMPOSIO_NOTE = "You sign in on a secure page from Composio, the partner BuPulse uses to connect social accounts. We never see your password.";

// BuPulse-Socials reads likes and comments only; a direct connection also reads reach and saves (lib/publishing/results.ts).
const professional = (viaComposio: boolean) => ["Posts automatically at the time you choose", "Photos and carousels of up to 10 images", viaComposio ? "Likes and comments in your reports" : "Reach, likes and saves in your reports", "For Business and Creator accounts"];

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm text-muted">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Instagram: professional (Business or Creator) accounts only, which BuPulse posts to automatically. */
function InstagramBody({ channel }: { channel: ChannelInfo }) {
  const viaFacebookOnly = !channel.viaComposio && !channel.configured;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-pulse-blue bg-ok-bg/40 p-4 shadow-glass">
        <span className="font-semibold">Professional account</span>
        <Checklist items={professional(Boolean(channel.viaComposio))} />
        {viaFacebookOnly && (
          <p className="text-sm text-muted">
            Log in with Facebook and choose your Instagram account. It must be a Business or Creator account linked to a Facebook Page.
          </p>
        )}
      </div>
      <div className="flex flex-col items-stretch gap-3">
        <a href={connectHref("instagram", primaryVariant(channel))} className={buttonClasses({ size: "lg", className: "w-full" })}>
          {viaFacebookOnly ? "Continue with Facebook" : "Connect Instagram"}
        </a>
        {channel.viaComposio ? (
          <p className="text-center text-xs text-muted">{COMPOSIO_NOTE}</p>
        ) : showFacebookLink(channel) ? (
          <a href={connectHref("instagram", "facebook")} className="min-h-11 py-3 text-center text-sm font-semibold text-pulse-blue underline-offset-4 hover:underline">
            Connect Instagram through Facebook
          </a>
        ) : null}
        <p className="text-center text-xs text-muted">
          Personal account? In the Instagram app open your profile settings, choose Account type and tools, and switch to a professional account. It is free.
        </p>
      </div>
    </div>
  );
}

/** The Connect modal. Instagram explains professional accounts; other networks get one simple card. */
export function ConnectDialog({ channel, onClose }: { channel: ChannelInfo; onClose: () => void }) {
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <Dialog open onOpenChange={close} title={`Connect ${channel.label}`} description={channel.network === "instagram" ? "Business and Creator accounts." : channel.note} className="max-w-xl">
      {channel.network === "instagram" ? (
        <InstagramBody channel={channel} />
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
