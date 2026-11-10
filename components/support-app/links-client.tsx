"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { ArrowRight, BadgeDollarSign, Check, Copy, FileText, Home, Link2, PartyPopper, PhoneCall, Plus, Rocket, Wand2 } from "lucide-react";
import { createLinkAction, type LinkActionState } from "@/app/support/(app)/links/actions";
import { cn } from "@/lib/cn";
import { CHANNELS, cleanDestination, normalizeCode, shortLink, type ChannelKey } from "@/lib/links/rules";
import { ChannelIcon } from "./channel-icon";

// The Links page's client parts: the guided "Make a link" card (three steps, every choice a tile, a live preview of the
// link) and the Copy button.

/** Copies a short link; says "Copied" for two seconds. */
export function CopyButton({ text, label = "Copy", strong = false }: { text: string; label?: string; strong?: boolean }) {
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
      className={cn(
        "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition-colors",
        strong ? "bg-white text-graphite shadow-sm hover:bg-white/90" : "border border-line bg-surface hover:bg-ok-bg",
      )}
      aria-label={`${label} ${text}`}
    >
      {done ? <Check aria-hidden className="size-4 text-ok" /> : <Copy aria-hidden className="size-4" />}
      {done ? "Copied" : label}
    </button>
  );
}

/** Tile names: the rules' labels, shortened to fit a tile. */
const SHORT: Partial<Record<ChannelKey, string>> = { x: "X", google: "Google", print: "Poster / QR", other: "Other" };

/** Ready names to tap, per channel. */
const NAME_IDEAS: Record<ChannelKey, string[]> = {
  instagram: ["Instagram bio", "Instagram story", "Instagram post", "Instagram ad"],
  facebook: ["Facebook page", "Facebook post", "Facebook group", "Facebook ad"],
  tiktok: ["TikTok bio", "TikTok video", "TikTok ad"],
  linkedin: ["LinkedIn page", "LinkedIn post", "LinkedIn profile"],
  whatsapp: ["WhatsApp status", "WhatsApp message", "WhatsApp group"],
  x: ["X bio", "X post"],
  youtube: ["YouTube description", "YouTube channel"],
  google: ["Google Business Profile", "Google ad"],
  email: ["Email signature", "Newsletter"],
  sms: ["SMS campaign", "SMS to a client"],
  print: ["Poster", "Flyer", "Business card"],
  other: ["Partner website", "Event"],
};

const PAGES: { path: string; label: string; hint: string; icon: ReactNode; best?: boolean }[] = [
  { path: "/quote", label: "Free quote", hint: "They leave a number, we call back", icon: <PhoneCall className="size-5" />, best: true },
  { path: "/", label: "Home page", hint: "The whole BuPulse story", icon: <Home className="size-5" /> },
  { path: "/pricing", label: "Pricing", hint: "Plans and prices", icon: <BadgeDollarSign className="size-5" /> },
  { path: "/signup", label: "Sign up", hint: "Start straight away", icon: <Rocket className="size-5" /> },
  { path: "other", label: "Another page", hint: "Any page of bupulse.com", icon: <FileText className="size-5" /> },
];

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold">
        <span
          aria-hidden
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors",
            done ? "bg-brand-gradient text-white" : "bg-soft text-muted",
          )}
        >
          {done ? <Check className="size-4" strokeWidth={3} /> : n}
        </span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

const tile = (on: boolean) =>
  cn(
    "group relative flex cursor-pointer rounded-2xl border-2 text-left outline-none transition-[transform,border-color,background-color,box-shadow] duration-200",
    "focus-visible:ring-4 focus-visible:ring-pulse-blue/30 hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none",
    on
      ? "border-pulse-blue bg-pulse-blue/[0.07] shadow-[0_8px_24px_-12px_rgba(47,107,255,0.55)] dark:bg-pulse-blue/15"
      : "border-line bg-surface hover:border-pulse-blue/40 hover:shadow-[0_8px_20px_-14px_rgba(17,24,39,0.35)]",
  );

function Tick() {
  return (
    <span aria-hidden className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white shadow">
      <Check className="size-3" strokeWidth={3.5} />
    </span>
  );
}

/** The link as it will look, building up while the steps are answered. */
function Preview({ site, channel, page, code, label }: { site: string; channel: ChannelKey | null; page: string | null; code: string; label: string }) {
  const host = site.replace(/^https?:\/\//, "");
  return (
    <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(140deg,#2f6bff_0%,#5b4dff_55%,#9b5cff_100%)] p-5 text-white shadow-[0_18px_40px_-20px_rgba(47,107,255,0.8)]">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-white/10 blur-2xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-14 -left-8 size-36 rounded-full bg-white/10 blur-2xl" />
      <p className="relative text-xs font-bold tracking-[0.06em] text-white/75">YOUR LINK</p>
      <div className="relative mt-3 flex items-center gap-3">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/95 shadow-sm">
          {channel ? <ChannelIcon channel={channel} className="size-8" /> : <Link2 aria-hidden className="size-6 text-pulse-blue" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{label || "Name your link"}</p>
          <p className="text-[13px] text-white/75">{channel ? (CHANNELS.find((c) => c.key === channel)?.label ?? channel) : "Pick where you share it"}</p>
        </div>
      </div>
      <p className="relative mt-4 rounded-2xl bg-white/15 px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-white/90 [overflow-wrap:anywhere]">
        {host}/go/<span className="font-bold text-white">{code}</span>
      </p>
      <p className="relative mt-3 flex items-center gap-2 text-xs font-semibold text-white/85">
        <ArrowRight aria-hidden className="size-4" />
        {page ? <>Opens <span className="rounded-full bg-white/20 px-2 py-0.5 text-white">{page}</span></> : "Pick the page it opens"}
      </p>
    </div>
  );
}

/** After making a link: the link, Copy, Send on WhatsApp, and Make another. */
function Created({ site, created, onAgain }: { site: string; created: NonNullable<LinkActionState["created"]>; onAgain: () => void }) {
  const url = shortLink(site, created.code);
  return (
    <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(140deg,#0f9f6e_0%,#2f6bff_60%,#7b5cff_100%)] p-5 text-white sm:p-6">
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-10 size-44 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-start gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <PartyPopper aria-hidden className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-bold">Your link is ready</p>
          <p className="text-sm text-white/85">{created.label}: share it, and every visit, quote and sign-up shows up below.</p>
        </div>
      </div>
      <p role="status" className="relative mt-4 break-all rounded-2xl bg-white/15 px-4 py-3 font-mono text-[15px] font-semibold">
        {url}
      </p>
      <div className="relative mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <CopyButton text={url} label="Copy link" strong />
        <a
          href={`https://wa.me/?text=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/15 px-3.5 text-sm font-semibold hover:bg-white/25"
        >
          <ChannelIcon channel="whatsapp" className="size-5" /> Send on WhatsApp
        </a>
        <button type="button" onClick={onAgain} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-sm font-semibold hover:bg-white/25">
          <Plus aria-hidden className="size-4" /> Make another
        </button>
      </div>
    </div>
  );
}

/** Three steps (where it is shared, the page it opens, its name), every choice a tile; the link previews as it is built. */
export function CreateLinkForm({ site, owner }: { site: string; owner: boolean }) {
  const [state, action, pending] = useActionState<LinkActionState, FormData>(createLinkAction, {});
  const [dismissed, setDismissed] = useState<string | null>(null);
  const created = state.created;
  if (created && dismissed !== created.code) return <Created site={site} created={created} onAgain={() => setDismissed(created.code)} />;
  // A new link starts the steps again from empty (a fresh builder); an error keeps what was chosen.
  return <LinkBuilder key={created?.code ?? "first"} site={site} owner={owner} action={action} pending={pending} error={state.error} />;
}

function LinkBuilder({ site, owner, action, pending, error }: { site: string; owner: boolean; action: (formData: FormData) => void; pending: boolean; error?: string }) {
  const [channel, setChannel] = useState<ChannelKey | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [ownWords, setOwnWords] = useState(false);
  const ids = { label: useId(), code: useId(), path: useId() };

  const destination = page === "other" ? cleanDestination(customPath) : page;
  const typedCode = ownWords ? normalizeCode(code) : null;
  const autoCode = `${(normalizeCode(label) ?? "your-link").slice(0, 30).replace(/-+$/, "")}-xxxx`;
  const previewCode = ownWords && code ? (typedCode ?? "…") : autoCode;
  const ready = !!channel && !!destination && label.trim().length > 0 && (!ownWords || !code || !!typedCode);

  return (
    <form action={action} className="relative rounded-[24px] border border-line bg-surface shadow-[0_24px_60px_-40px_rgba(17,24,39,0.45)]">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-[24px] bg-brand-gradient" />
      <input type="hidden" name="channel" value={channel ?? ""} />
      <input type="hidden" name="destination" value={page ?? ""} />
      <input type="hidden" name="customPath" value={customPath} />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-7">
          <header className="flex items-start gap-3">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_24px_-12px_rgba(47,107,255,0.9)]">
              <Wand2 aria-hidden className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold tracking-[-0.01em]">Make a link</h2>
              <p className="text-sm text-muted">
                {owner
                  ? "Company links for BuPulse's own pages: every visitor they bring is the company's."
                  : "Give it to clients: everyone who comes through it is your lead."}
              </p>
            </div>
          </header>

          <Step n={1} title="Where will you share it?" done={!!channel}>
            <div role="radiogroup" aria-label="Where you will share the link" className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 xl:grid-cols-6">
              {CHANNELS.map((c) => {
                const on = channel === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setChannel(c.key)}
                    className={cn(tile(on), "flex-col items-center justify-center gap-2 px-1.5 py-3.5 text-center")}
                  >
                    <ChannelIcon channel={c.key} className="size-9 transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none" />
                    <span className="text-[12.5px] font-semibold leading-tight">{SHORT[c.key] ?? c.label}</span>
                    {on && <Tick />}
                  </button>
                );
              })}
            </div>
          </Step>

          <Step n={2} title="Which page should it open?" done={!!destination}>
            <div role="radiogroup" aria-label="The page the link opens" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {PAGES.map((p) => {
                const on = page === p.path;
                return (
                  <button key={p.path} type="button" role="radio" aria-checked={on} onClick={() => setPage(p.path)} className={cn(tile(on), "items-center gap-3 p-3.5")}>
                    <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors", on ? "bg-brand-gradient text-white" : "bg-soft text-text")}>
                      {p.icon}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold">
                        {p.label}
                        {p.best && <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-bold text-ok">Best for leads</span>}
                      </span>
                      <span className="text-[13px] text-muted">{p.hint}</span>
                    </span>
                    {on && <Tick />}
                  </button>
                );
              })}
            </div>
            {page === "other" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={ids.path} className="text-[13px] font-semibold">
                  Page of bupulse.com
                </label>
                <div className="flex min-h-12 items-center rounded-xl border border-line bg-surface px-3 focus-within:border-pulse-blue focus-within:ring-4 focus-within:ring-pulse-blue/15">
                  <span className="shrink-0 text-sm text-muted">bupulse.com</span>
                  <input
                    id={ids.path}
                    value={customPath}
                    onChange={(e) => setCustomPath(e.target.value.startsWith("/") || e.target.value === "" ? e.target.value : `/${e.target.value}`)}
                    placeholder="/pricing"
                    maxLength={200}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none"
                  />
                </div>
                {customPath && !destination && <p className="text-[13px] text-danger">Type a page of bupulse.com, for example /pricing.</p>}
              </div>
            )}
          </Step>

          <Step n={3} title="Give it a name" done={label.trim().length > 0}>
            {channel && (
              <div className="flex flex-wrap gap-2" aria-label="Name ideas">
                {NAME_IDEAS[channel].map((idea) => {
                  const on = label === idea;
                  return (
                    <button
                      key={idea}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setLabel(idea)}
                      className={cn(
                        "inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                        on ? "border-transparent bg-graphite text-white dark:bg-white dark:text-graphite" : "border-line bg-surface hover:border-pulse-blue/50 hover:bg-pulse-blue/5",
                      )}
                    >
                      {on && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
                      {idea}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.label} className="text-[13px] font-semibold">
                {channel ? "Or type your own" : "Name (only your team sees it)"}
              </label>
              <input
                id={ids.label}
                name="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
                placeholder={owner ? "Instagram bio" : "My WhatsApp status"}
                className="min-h-12 rounded-xl border border-line bg-surface px-3.5 text-[15px] outline-none focus:border-pulse-blue focus:ring-4 focus:ring-pulse-blue/15"
              />
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-soft p-3">
              <div role="radiogroup" aria-label="The words after /go/" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
                {[
                  { own: false, label: "Make it for me" },
                  { own: true, label: "Choose my words" },
                ].map((o) => (
                  <button
                    key={String(o.own)}
                    type="button"
                    role="radio"
                    aria-checked={ownWords === o.own}
                    onClick={() => setOwnWords(o.own)}
                    className={cn(
                      "min-h-10 cursor-pointer rounded-lg px-2 text-sm font-semibold transition-colors",
                      ownWords === o.own ? "bg-brand-gradient text-white shadow-sm" : "text-muted hover:text-text",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {ownWords ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={ids.code} className="sr-only">
                    The words after bupulse.com/go/
                  </label>
                  <div className="flex min-h-12 items-center rounded-xl border border-line bg-surface px-3 focus-within:border-pulse-blue focus-within:ring-4 focus-within:ring-pulse-blue/15">
                    <span className="shrink-0 text-sm text-muted">bupulse.com/go/</span>
                    <input
                      id={ids.code}
                      name="code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      maxLength={40}
                      placeholder="ig-bio"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="min-w-0 flex-1 bg-transparent py-2 font-mono text-[15px] outline-none"
                    />
                  </div>
                  <p className="text-[13px] text-muted">{code && !typedCode ? "3 to 40 letters, numbers or dashes." : "Short and easy to say works best, like ig-bio."}</p>
                </div>
              ) : (
                <p className="px-1 text-[13px] text-muted">We make it from the name, with 4 letters at the end so it is never taken.</p>
              )}
            </div>
          </Step>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <Preview site={site} channel={channel} page={destination} code={previewCode} label={label.trim()} />
          {error && (
            <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!ready || pending}
            className="inline-flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-5 text-[15px] font-bold text-white shadow-[0_14px_30px_-14px_rgba(47,107,255,0.9)] transition-[transform,opacity] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 motion-reduce:transform-none"
          >
            {pending ? "Making your link…" : "Make the link"}
            {!pending && <ArrowRight aria-hidden className="size-5" />}
          </button>
          {!ready && (
            <p className="text-center text-[13px] text-muted">
              {!channel ? "Pick where you will share it." : !destination ? "Pick the page it opens." : !label.trim() ? "Give it a name." : "Check the link words."}
            </p>
          )}
        </aside>
      </div>
    </form>
  );
}
