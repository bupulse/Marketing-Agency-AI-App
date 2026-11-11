"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { ArrowRight, Briefcase, Check, Clock3, LayoutGrid, LogOut, Megaphone, PartyPopper, Plus, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/cn";
import type { ServiceId } from "@/lib/platform/app-hosts";

// The service chooser (bupulse.com/apps) and the "Pick what to start" step (/apps/start) after the one client sign-in
// (docs/HOSTS.md). The support app's look: big rounded cards (22-24 px), a gradient tile per service, a lift on hover,
// a ring on keyboard focus, one column on phones. Every card opens a full page (another host), so they are plain <a>.

export type CardView = { id: ServiceId | "creator"; name: string; tagline: string; href: string | null; company: string | null; status: string | null };

const LOOK: Record<CardView["id"], { icon: ReactNode; tile: string; glow: string }> = {
  marketing: { icon: <Megaphone aria-hidden className="size-7" />, tile: "bg-[linear-gradient(140deg,#2f6bff_0%,#5b4dff_55%,#9b5cff_100%)]", glow: "shadow-[0_14px_30px_-14px_rgba(47,107,255,0.9)]" },
  agency: { icon: <Briefcase aria-hidden className="size-7" />, tile: "bg-[linear-gradient(140deg,#0f9f6e_0%,#1f8fd6_55%,#2f6bff_100%)]", glow: "shadow-[0_14px_30px_-14px_rgba(15,159,110,0.8)]" },
  creator: { icon: <Sparkles aria-hidden className="size-7" />, tile: "bg-[linear-gradient(140deg,#ff5c8a_0%,#c04dff_55%,#7b5cff_100%)]", glow: "shadow-[0_14px_30px_-14px_rgba(192,77,255,0.8)]" },
};

/** The page around both screens: the logo, the theme, the content, who is signed in and Sign out. */
export function ServicesPage({ email, children }: { email: string | null; children: ReactNode }) {
  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-bg">
      <span aria-hidden className="pointer-events-none absolute -left-24 -top-32 size-[28rem] rounded-full bg-pulse-blue/15 blur-3xl dark:bg-pulse-blue/20" />
      <span aria-hidden className="pointer-events-none absolute -right-24 top-40 size-[24rem] rounded-full bg-[#9b5cff]/15 blur-3xl dark:bg-[#9b5cff]/20" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" aria-label="BuPulse home" className="inline-flex min-h-11 items-center rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30">
            <Logo height={30} priority />
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 flex-col gap-7">{children}</main>
        {email && (
          <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-2 text-[13px] text-muted">
            <span>
              Signed in as <strong className="font-semibold text-text">{email}</strong>
            </span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl px-2 font-semibold text-pulse-blue hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30">
                <LogOut aria-hidden className="size-4" /> Sign out
              </button>
            </form>
          </footer>
        )}
      </div>
    </div>
  );
}

/** The card body shared by the chooser and the picker: the gradient tile, the name, what it is for, the details. */
function CardBody({ card, badge }: { card: CardView; badge?: ReactNode }) {
  const look = LOOK[card.id];
  return (
    <>
      <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-[24px]", look.tile)} />
      <span className="flex items-start justify-between gap-3">
        <span className={cn("inline-flex size-14 shrink-0 items-center justify-center rounded-[18px] text-white transition-transform duration-200 group-hover:scale-105 motion-reduce:transform-none", look.tile, look.glow)}>{look.icon}</span>
        {badge}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-[19px] font-bold tracking-[-0.01em]">{card.name}</span>
        <span className="text-[14.5px] leading-snug text-muted">{card.tagline}</span>
      </span>
      {(card.company || card.status) && (
        <span className="mt-auto flex flex-col gap-1.5 border-t border-line pt-3.5 text-[13.5px]">
          {card.company && <span className="truncate font-semibold">{card.company}</span>}
          {card.status && (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Clock3 aria-hidden className="size-3.5 shrink-0" />
              {card.status}
            </span>
          )}
        </span>
      )}
    </>
  );
}

const cardClass =
  "group relative flex min-h-[15rem] flex-col gap-4 overflow-hidden rounded-[24px] border border-line bg-surface p-5 text-left no-underline shadow-[0_24px_60px_-40px_rgba(17,24,39,0.45)] outline-none transition-[transform,box-shadow,border-color] duration-200 sm:p-6 motion-reduce:transform-none motion-reduce:transition-none";

/** "Where do you want to go?": one big card per service the person has, plus the ones they wait for. */
export function ServiceChooser({ firstName, cards, waiting, addHref }: { firstName: string | null; cards: CardView[]; waiting: CardView[]; addHref: string | null }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.08em] text-pulse-blue">
          <LayoutGrid aria-hidden className="size-4" /> YOUR BUPULSE
        </p>
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] sm:text-[34px]">{firstName ? `Welcome back, ${firstName}.` : "Welcome back."} Where to?</h1>
        <p className="max-w-xl text-[15px] text-muted">Tap a service to open it. You stay signed in to all of them, and signing out here signs you out everywhere.</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <li key={c.id} className="flex">
            <a
              href={c.href ?? undefined}
              className={cn(cardClass, "w-full cursor-pointer hover:-translate-y-1 hover:border-pulse-blue/40 hover:shadow-[0_28px_60px_-30px_rgba(47,107,255,0.55)] focus-visible:ring-4 focus-visible:ring-pulse-blue/35 active:translate-y-0")}
            >
              <CardBody
                card={c}
                badge={
                  <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-pulse-blue/10 px-3 text-[13px] font-semibold text-pulse-blue transition-colors group-hover:bg-pulse-blue group-hover:text-white dark:text-[#8db0ff] dark:group-hover:text-white">
                    Open <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
                  </span>
                }
              />
            </a>
          </li>
        ))}
        {waiting.map((c) => (
          <li key={c.id} className="flex">
            <div className={cn(cardClass, "w-full border-dashed bg-surface/70")} aria-label={`${c.name}: coming soon`}>
              <CardBody card={c} badge={<SoonBadge />} />
            </div>
          </li>
        ))}
        {addHref && (
          <li className="flex">
            <a
              href={addHref}
              className="group flex min-h-[15rem] w-full flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed border-line p-6 text-center text-muted no-underline outline-none transition-colors hover:border-pulse-blue/50 hover:text-text focus-visible:ring-4 focus-visible:ring-pulse-blue/35"
            >
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-soft transition-transform group-hover:scale-105 motion-reduce:transform-none">
                <Plus aria-hidden className="size-6" />
              </span>
              <span className="text-[15px] font-semibold">Add a service</span>
              <span className="text-[13px]">See what else BuPulse can do</span>
            </a>
          </li>
        )}
      </ul>
    </>
  );
}

function SoonBadge() {
  return <span className="inline-flex min-h-8 items-center rounded-full bg-[#fff4d6] px-3 text-[12.5px] font-bold text-[#8a5a00] dark:bg-[#3a2c07] dark:text-[#ffd27a]">Coming soon</span>;
}

export type PickState = { error?: string };

/**
 * "What do you want to start?": the same cards as tiles to tick. Marketing starts the free trial and its set-up;
 * Agency is not ready yet, so ticking it puts the person on the list (kept in their account for phase 2). "Both" ticks
 * both. At least one is needed.
 */
export function ServicePicker({ action, initial, listed }: { action: (state: PickState, form: FormData) => Promise<PickState>; initial: ServiceId[]; listed: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [picked, setPicked] = useState<ServiceId[]>(initial);
  const toggle = (id: ServiceId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const both = picked.includes("marketing") && picked.includes("agency");
  const tiles: { card: CardView; note: string; soon: boolean }[] = [
    { card: { id: "marketing", name: "BuPulse Marketing", tagline: "Posts, videos, a calendar and the leads they bring, made for your business.", href: null, company: null, status: null }, note: "Starts your free trial", soon: false },
    { card: { id: "agency", name: "BuPulse Agency", tagline: "Run your agency's clients, projects and reports in one place.", href: null, company: null, status: null }, note: "Not ready yet: tick it and we will tell you when it is", soon: true },
  ];

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {listed ? (
        <div role="status" className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(140deg,#0f9f6e_0%,#2f6bff_60%,#7b5cff_100%)] p-5 text-white sm:p-6">
          <span aria-hidden className="pointer-events-none absolute -right-12 -top-10 size-44 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start gap-3">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/20">
              <PartyPopper aria-hidden className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-bold">You are on the list for BuPulse Agency</p>
              <p className="text-sm text-white/85">We will email you the day it opens. Meanwhile, Marketing is ready now: tick it to start your free trial.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.08em] text-pulse-blue">
            <Sparkles aria-hidden className="size-4" /> ONE ACCOUNT, EVERY SERVICE
          </p>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] sm:text-[34px]">What do you want to start?</h1>
          <p className="max-w-xl text-[15px] text-muted">Pick one, or both. You can add the other one later from the same account.</p>
        </div>
      )}

      <div role="group" aria-label="BuPulse services" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tiles.map(({ card, note, soon }) => {
          const on = picked.includes(card.id as ServiceId);
          return (
            <label
              key={card.id}
              className={cn(
                cardClass,
                "cursor-pointer has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-pulse-blue/35 hover:-translate-y-1 active:translate-y-0",
                on ? "border-2 border-pulse-blue bg-pulse-blue/[0.06] shadow-[0_24px_50px_-28px_rgba(47,107,255,0.7)] dark:bg-pulse-blue/15" : "border-2 hover:border-pulse-blue/40",
              )}
            >
              <input type="checkbox" name="service" value={card.id} checked={on} onChange={() => toggle(card.id as ServiceId)} className="sr-only" />
              <CardBody
                card={card}
                badge={
                  <span className="flex items-center gap-2">
                    {soon && <SoonBadge />}
                    <span aria-hidden className={cn("inline-flex size-7 items-center justify-center rounded-full border-2 transition-colors", on ? "border-pulse-blue bg-pulse-blue text-white" : "border-line bg-surface")}>
                      {on && <Check className="size-4" strokeWidth={3.5} />}
                    </span>
                  </span>
                }
              />
              <span className={cn("mt-auto text-[13px] font-semibold", on ? "text-pulse-blue dark:text-[#8db0ff]" : "text-muted")}>{note}</span>
            </label>
          );
        })}
      </div>

      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setPicked(both ? ["marketing"] : ["marketing", "agency"])}
          aria-pressed={both}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 text-[14px] font-semibold hover:border-pulse-blue/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
        >
          <LayoutGrid aria-hidden className="size-4 text-pulse-blue" /> {both ? "Just Marketing" : "Both, please"}
        </button>
        <button
          type="submit"
          disabled={pending || picked.length === 0}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-6 text-[15px] font-bold text-white shadow-[0_14px_30px_-14px_rgba(47,107,255,0.9)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transform-none"
        >
          {pending ? "One moment…" : picked.includes("marketing") ? "Continue" : picked.length ? "Put me on the list" : "Pick a service"}
          <ArrowRight aria-hidden className="size-5" />
        </button>
      </div>
    </form>
  );
}
