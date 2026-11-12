"use client";

import Link from "next/link";
import { Fragment } from "react";
import { NetworkIcon } from "@/components/publishing/network-icon";
import { cn } from "@/lib/cn";
import { extraHashtags, initialOf, splitCaption } from "./helpers";
import type { Account, MediaAction, Platform, StatusKey } from "./types";
import s from "./media-cards.module.css";

// Small pieces shared by every media card.

const STATUS: Record<StatusKey, { label: string; dot: string; tone: string; live?: boolean }> = {
  draft: { label: "Draft", dot: "bg-slate", tone: "bg-black/5 text-text dark:bg-white/10" },
  pending: { label: "Waiting for approval", dot: "bg-amber-500", tone: "bg-amber-500/12 text-amber-800 dark:text-amber-300" },
  scheduled: { label: "Scheduled", dot: "bg-pulse-blue", tone: "bg-ok-bg text-ok" },
  publishing: { label: "Posting now", dot: "bg-pulse-violet", tone: "bg-new-bg text-new", live: true },
  posted: { label: "Posted", dot: "bg-emerald-500", tone: "bg-success-bg text-success" },
  failed: { label: "Failed", dot: "bg-danger", tone: "bg-danger-bg text-danger" },
  reminder: { label: "Post it yourself", dot: "bg-amber-500", tone: "bg-amber-500/12 text-amber-800 dark:text-amber-300" },
  expired: { label: "Expired", dot: "bg-slate", tone: "bg-black/5 text-muted dark:bg-white/10" },
  cancelled: { label: "Cancelled", dot: "bg-slate", tone: "bg-black/5 text-muted dark:bg-white/10" },
  ready: { label: "Ready", dot: "bg-emerald-500", tone: "bg-success-bg text-success" },
  new: { label: "New", dot: "bg-pulse-violet", tone: "bg-new-bg text-new" },
  live: { label: "Live", dot: "bg-emerald-500", tone: "bg-success-bg text-success", live: true },
  paused: { label: "Paused", dot: "bg-amber-500", tone: "bg-amber-500/12 text-amber-800 dark:text-amber-300" },
  ended: { label: "Ended", dot: "bg-slate", tone: "bg-black/5 text-muted dark:bg-white/10" },
};

export const statusText = (key: StatusKey) => STATUS[key].label;

/**
 * The status pill: a dot plus words (never colour alone). `glass` is the version on top of media (white text on dark
 * glass).
 */
export function StatusPill({ status, label, glass = false, className }: { status: StatusKey; label?: string | null; glass?: boolean; className?: string }) {
  const st = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold whitespace-nowrap",
        glass ? "border border-white/25 bg-black/40 text-white backdrop-blur-md" : st.tone,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", st.dot, st.live && s.ping)} />
      <span className="truncate">{label || st.label}</span>
    </span>
  );
}

/** A row of platform badges. */
export function PlatformIcons({ platforms, size = 18, className }: { platforms: readonly Platform[]; size?: number; className?: string }) {
  if (platforms.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {platforms.map((p, i) => (
        <NetworkIcon key={p} network={p} size={size} className={cn("ring-2 ring-black/20", i > 0 && "-ml-1.5")} />
      ))}
    </span>
  );
}

/** The company's picture (or its first letter) with an optional platform badge. */
export function AccountPicture({ account, platform, size = 36, ring = true }: { account: Account; platform?: Platform; size?: number; ring?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span className={cn("inline-flex size-full overflow-hidden rounded-full", ring && "p-[2px] bg-[linear-gradient(135deg,#2f6bff,#7b5cff)]")}>
        <span className="inline-flex size-full overflow-hidden rounded-full bg-surface p-[1.5px]">
          {account.avatarUrl ? (
            // Logos come from signed storage links or network CDNs, which next/image is not configured for.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.avatarUrl} alt="" className="size-full rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span aria-hidden className="inline-flex size-full items-center justify-center rounded-full bg-soft text-[13px] font-bold text-pulse-blue">
              {initialOf(account.name)}
            </span>
          )}
        </span>
      </span>
      {platform && <NetworkIcon network={platform} size={Math.max(14, Math.round(size * 0.42))} className="absolute -right-1 -bottom-1 ring-2 ring-[var(--bp-bg-solid)]" />}
    </span>
  );
}

/** A caption with #hashtags and @mentions in brand blue, links underlined, and the post's own hashtags after it. */
export function CaptionText({ text, hashtags, className }: { text: string; hashtags?: readonly string[]; className?: string }) {
  const extra = extraHashtags(text, hashtags);
  return (
    <span className={cn("break-words whitespace-pre-line", className)}>
      {splitCaption(text).map((t, i) =>
        t.type === "text" ? (
          <Fragment key={i}>{t.value}</Fragment>
        ) : t.type === "link" ? (
          <span key={i} className="text-[var(--bp-link)] underline underline-offset-2">
            {t.value}
          </span>
        ) : (
          <span key={i} className="font-medium text-[#1f55e0] dark:text-[#8db0ff]">
            {t.value}
          </span>
        ),
      )}
      {extra.length > 0 && (
        <>
          {text.trim() ? " " : ""}
          <span className="font-medium text-[#1f55e0] dark:text-[#8db0ff]">{extra.join(" ")}</span>
        </>
      )}
    </span>
  );
}

const ACTION_TONE = {
  primary: "bg-[linear-gradient(135deg,#2f6bff,#7b5cff)] text-white shadow-glow hover:shadow-glow-hover border-transparent",
  danger: "border-line text-danger hover:bg-danger-bg",
  default: "border-line text-text hover:bg-soft",
} as const;

/**
 * Our real actions (Edit, Schedule, Approve, Delete...) as labelled pill buttons, 44 px tall. `compact` shows icons only on
 * phones (the label stays for screen readers and as a tooltip).
 */
export function ActionRow({ actions, compact = false, className, onDark = false }: { actions: MediaAction[]; compact?: boolean; className?: string; onDark?: boolean }) {
  if (actions.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {actions.map((a) => {
        const cls = onDark
          ? cn(s.glassBtn, a.tone === "primary" && s.glassBtnPrimary, a.tone === "danger" && "!text-[#ffb3bf]", "min-h-11 cursor-pointer px-4 disabled:opacity-50")
          : cn(
              "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-4 text-[13.5px] font-semibold transition-[transform,background-color,box-shadow] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
              ACTION_TONE[a.tone ?? "default"],
              compact && "max-sm:size-11 max-sm:px-0",
            );
        const inner = (
          <>
            {a.icon && <span aria-hidden className="inline-flex [&>svg]:size-4">{a.icon}</span>}
            <span className={cn(compact && a.icon && "max-sm:sr-only")}>{a.label}</span>
          </>
        );
        return a.href ? (
          <Link key={a.id} href={a.href} className={cls} title={a.label} aria-disabled={a.disabled || undefined}>
            {inner}
          </Link>
        ) : (
          <button key={a.id} type="button" className={cls} onClick={a.onClick} disabled={a.disabled} title={a.label}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
