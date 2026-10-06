"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Sparkles, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Meter } from "@/components/ui";
import { cn } from "@/lib/cn";

export type TrialBannerProps = {
  isTrial: boolean;
  /** null when not on a trial. */
  trialDaysLeft: number | null;
  /** Subscription status is trialing or active. */
  subscriptionActive: boolean;
  /** Subscription status is PAST_DUE: the last payment failed and the account is limited. */
  pastDue?: boolean;
  text: { used: number; max: number };
  image: { used: number; max: number };
};

const STORAGE_KEY = "bp-trial-banner-dismissed";
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const pct = (u: { used: number; max: number }) => (u.max > 0 ? (u.used / u.max) * 100 : 0);

export type BannerState = "normal" | "warning" | "ended" | "usage" | "pastDue" | "hidden";

export function bannerState(p: TrialBannerProps): BannerState {
  if (p.pastDue) return "pastDue";
  const nearLimit = pct(p.text) >= 80 || pct(p.image) >= 80;
  if (!p.isTrial) return nearLimit ? "usage" : "hidden";
  if (p.trialDaysLeft === 0 || !p.subscriptionActive) return "ended";
  if ((p.trialDaysLeft !== null && p.trialDaysLeft <= 2) || nearLimit) return "warning";
  return "normal";
}

export function TrialBanner(props: TrialBannerProps) {
  const state = bannerState(props);
  const storedDismissed = useSyncExternalStore(subscribe, readDismissed, () => false);
  const [localDismissed, setLocalDismissed] = useState(false);

  if (state === "hidden") return null;
  if (state === "normal" && (storedDismissed || localDismissed)) return null;

  const dismiss = () => {
    setLocalDismissed(true);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Dismissal just lasts until the next navigation.
    }
    listeners.forEach((l) => l());
  };

  const { trialDaysLeft: days, text, image } = props;
  const alert = state !== "normal";
  const Icon = alert ? AlertTriangle : Sparkles;

  let title: string;
  if (state === "pastDue") title = "Payment failed — update your payment method";
  else if (state === "ended") title = "Your trial has ended — choose a plan to keep creating";
  else if (state === "usage") title = "You are close to a plan limit";
  else title = `${days} ${days === 1 ? "day" : "days"} left in your free trial`;

  const href = state === "usage" ? "/dashboard/usage" : "/dashboard/billing";
  const cta =
    state === "usage" ? "View usage" : state === "ended" ? "Choose a plan" : state === "pastDue" ? "Update payment" : "See plans";

  const meters = [
    { label: "Text generations", ...text },
    { label: "Image generations", ...image },
  ].filter((m) => m.max > 0);

  return (
    <div
      role="status"
      className={cn(
        "glass-strong flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[20px] border p-3.5 pr-3 sm:px-4",
        state === "ended" || state === "usage" || state === "pastDue" ? "border-danger/40" : state === "warning" ? "border-pulse-violet/40" : "border-pulse-blue/30",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl",
          state === "ended" || state === "usage" || state === "pastDue" ? "bg-danger-bg text-danger" : "bg-brand-gradient text-white",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
        <p className="text-[15px] font-semibold leading-snug">{title}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {meters.map((m) => (
            <div key={m.label} className="flex min-w-[140px] flex-1 flex-col gap-1">
              <Meter value={m.used} max={m.max} label={m.label} />
              <span className="text-xs text-muted">
                {m.label}: {m.used} of {m.max}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold no-underline hover:bg-soft"
        >
          {cta}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
        {state === "normal" && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss trial banner"
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
