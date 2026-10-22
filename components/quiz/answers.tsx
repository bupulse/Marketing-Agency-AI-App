"use client";

import { Check, Pencil, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { GuessTag, typingInField } from "./frame";

// The ways to answer a quiz question (docs/QUIZ_MODE.md): one tap on a tile, chips, this or that, keep or drop, a
// slider, a short text with ready answers to tap. Every one shows BuPulse's guess so the owner only confirms.

export type TileOption<T extends string> = { value: T; label: string; hint?: string; emoji?: string; icon?: ReactNode };

/**
 * Big tiles, one answer. A tap picks (and the quiz may move on); the number keys 1-9 pick too. `guess` gets the
 * "Our guess" tag.
 */
export function Tiles<T extends string>({
  options,
  value,
  onPick,
  guess,
  columns = 2,
  label,
}: {
  options: readonly TileOption<T>[];
  value: T | null;
  onPick: (v: T) => void;
  guess?: T | null;
  columns?: 1 | 2 | 3;
  label: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, options.length)) {
        e.preventDefault();
        onPick(options[n - 1].value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onPick]);
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2.5", columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(o.value)}
            className={cn(
              "group relative flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
              on ? "border-pulse-blue bg-pulse-blue/8" : "border-line bg-surface hover:border-pulse-blue/40",
            )}
          >
            {(o.emoji || o.icon) && (
              <span aria-hidden className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl", on ? "bg-brand-gradient text-white" : "bg-soft")}>
                {o.emoji ?? o.icon}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold">
                {o.label}
                {guess === o.value && <GuessTag />}
              </span>
              {o.hint && <span className="text-[13px] leading-snug text-muted">{o.hint}</span>}
            </span>
            <span aria-hidden className="hidden text-[11px] font-semibold text-muted sm:inline">
              {i < 9 ? i + 1 : ""}
            </span>
            {on && <Check aria-hidden className="absolute right-2.5 top-2.5 size-4 text-pulse-blue" />}
          </button>
        );
      })}
    </div>
  );
}

/** Two big cards side by side ("Friendly" or "Formal"); a tap picks. Keys 1 and 2 too. */
export function ThisOrThat<T extends string>({ left, right, value, onPick, label }: { left: TileOption<T>; right: TileOption<T>; value: T | null; onPick: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-3">
      {[left, right].map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(o.value)}
            className={cn(
              "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 p-4 text-center transition-[transform,border-color] duration-200 hover:-translate-y-1 motion-reduce:hover:translate-y-0",
              on ? "border-pulse-blue bg-pulse-blue/8" : "border-line bg-surface hover:border-pulse-blue/40",
            )}
          >
            <span aria-hidden className="text-4xl">
              {o.emoji ?? (i === 0 ? "👈" : "👉")}
            </span>
            <span className="text-[17px] font-semibold">{o.label}</span>
            {o.hint && <span className="text-[13px] leading-snug text-muted">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Chips, several answers. BuPulse's ideas (`suggested`) come first with a sparkle; the owner taps to keep or drop, and
 * can add their own.
 */
export function Chips({
  options,
  suggested = [],
  values,
  onChange,
  max,
  addPlaceholder,
  addMax = 80,
  label,
}: {
  options: readonly string[];
  suggested?: readonly string[];
  values: string[];
  onChange: (v: string[]) => void;
  max?: number;
  /** Shows "+ Add your own" when set. */
  addPlaceholder?: string;
  addMax?: number;
  label: string;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const lower = new Set(values.map((v) => v.toLowerCase()));
  const sparkle = new Set(suggested.map((s) => s.toLowerCase()));
  const all: string[] = [];
  for (const o of [...suggested, ...options, ...values]) if (!all.some((x) => x.toLowerCase() === o.toLowerCase())) all.push(o);
  const full = max !== undefined && values.length >= max;

  function toggle(o: string) {
    if (lower.has(o.toLowerCase())) onChange(values.filter((v) => v.toLowerCase() !== o.toLowerCase()));
    else if (!full) onChange([...values, o]);
  }
  function add() {
    const v = text.trim().replace(/\s+/g, " ").slice(0, addMax);
    if (v && !lower.has(v.toLowerCase()) && !full) onChange([...values, v]);
    setText("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {all.map((o) => {
          const on = lower.has(o.toLowerCase());
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o)}
              disabled={!on && full}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] font-medium transition-[transform,background-color] duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:hover:translate-y-0",
                on ? "border-transparent bg-brand-gradient text-white" : "border-line bg-surface text-text",
              )}
            >
              {on ? <Check aria-hidden className="size-3.5" /> : sparkle.has(o.toLowerCase()) ? <Sparkles aria-hidden className="size-3.5 text-pulse-violet" /> : null}
              {o}
            </button>
          );
        })}
        {addPlaceholder &&
          !adding &&
          !full && (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-line px-4 py-2 text-[14px] font-medium text-muted hover:text-text">
              <Plus aria-hidden className="size-3.5" />
              Add your own
            </button>
          )}
      </div>
      {addPlaceholder && adding && (
        <div className="flex gap-2">
          <Input
            autoFocus
            aria-label="Your own answer"
            value={text}
            maxLength={addMax}
            placeholder={addPlaceholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button type="button" onClick={add} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full bg-soft px-4 text-[14px] font-semibold">
            Add
          </button>
        </div>
      )}
      {max !== undefined && <p className="text-[12px] text-muted">{full ? `That's the most (${max}). Tap one to swap it.` : `${values.length} picked${max ? `, up to ${max}` : ""}.`}</p>}
    </div>
  );
}

/**
 * A short written answer, with ready answers to tap (BuPulse's ideas). Tapping one fills the field; the owner can
 * still change it.
 */
export function TextAnswer({
  value,
  onChange,
  suggestions = [],
  placeholder,
  maxLength,
  multiline = false,
  label,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
  label: string;
  inputMode?: "text" | "numeric" | "tel" | "email" | "url";
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2" role="group" aria-label="Ideas to tap">
          {suggestions.map((s) => {
            const on = s === value;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(s)}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-2xl border-2 px-4 py-3 text-left text-[15px] transition-[border-color,background-color] duration-200",
                  on ? "border-pulse-blue bg-pulse-blue/8 font-medium" : "border-line bg-surface hover:border-pulse-blue/40",
                )}
              >
                {on ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-blue" /> : <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-violet" />}
                <span>{s}</span>
              </button>
            );
          })}
        </div>
      )}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {multiline ? (
        <Textarea id={id} rows={3} value={value} maxLength={maxLength} placeholder={placeholder ?? (suggestions.length ? "Or write your own" : undefined)} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} maxLength={maxLength} inputMode={inputMode} placeholder={placeholder ?? (suggestions.length ? "Or write your own" : undefined)} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export type KeepItem = { id: string; text: string; sub?: string };

/**
 * BuPulse's ideas as cards to keep or drop (FAQs, highlights, rules). Tap the pencil to change the words; add another
 * at the bottom. `kept` holds the ids kept.
 */
export function KeepOrDrop({
  items,
  kept,
  onChange,
  onEdit,
  onAdd,
  maxLength = 200,
  subMaxLength = 600,
  addLabel = "Add another",
  withSub,
  label,
}: {
  items: KeepItem[];
  kept: string[];
  onChange: (kept: string[]) => void;
  onEdit?: (id: string, patch: { text: string; sub?: string }) => void;
  onAdd?: (item: { text: string; sub?: string }) => void;
  maxLength?: number;
  subMaxLength?: number;
  addLabel?: string;
  /** Each card has a second text (an FAQ's answer); found from the items when not given. */
  withSub?: boolean;
  label: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ text: "", sub: "" });
  const [adding, setAdding] = useState(false);
  const hasSub = withSub ?? items.some((i) => i.sub !== undefined);

  function open(item: KeepItem | null) {
    setDraft({ text: item?.text ?? "", sub: item?.sub ?? "" });
    setEditing(item?.id ?? null);
    setAdding(!item);
  }
  function close() {
    setEditing(null);
    setAdding(false);
  }
  function save() {
    const text = draft.text.trim();
    if (!text) return close();
    const patch = { text, ...(hasSub ? { sub: draft.sub.trim() } : {}) };
    if (adding) onAdd?.(patch);
    else if (editing) onEdit?.(editing, patch);
    close();
  }

  const editor = (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-pulse-blue bg-surface p-3">
      <Textarea autoFocus rows={2} aria-label="The words" value={draft.text} maxLength={maxLength} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} />
      {hasSub && <Textarea rows={3} aria-label="The answer" value={draft.sub} maxLength={subMaxLength} onChange={(e) => setDraft((d) => ({ ...d, sub: e.target.value }))} />}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} className="min-h-10 cursor-pointer rounded-full px-4 text-[14px] font-medium text-muted">
          Cancel
        </button>
        <button type="button" onClick={save} className="min-h-10 cursor-pointer rounded-full bg-brand-gradient px-4 text-[14px] font-semibold text-white">
          Done
        </button>
      </div>
    </div>
  );

  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {items.map((item) => {
        const on = kept.includes(item.id);
        if (editing === item.id) return <li key={item.id}>{editor}</li>;
        return (
          <li key={item.id} className={cn("flex items-start gap-2 rounded-2xl border-2 p-3 transition-[opacity,border-color] duration-200", on ? "border-pulse-blue/50 bg-surface" : "border-line bg-soft opacity-60")}>
            <button
              type="button"
              aria-pressed={on}
              aria-label={on ? `Keep: ${item.text}` : `Dropped: ${item.text}`}
              onClick={() => onChange(on ? kept.filter((k) => k !== item.id) : [...kept, item.id])}
              className={cn("inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full", on ? "bg-brand-gradient text-white" : "bg-surface text-muted")}
            >
              {on ? <Check aria-hidden className="size-4" /> : <X aria-hidden className="size-4" />}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1.5">
              <p className={cn("text-[15px] font-medium", !on && "line-through")}>{item.text}</p>
              {item.sub && <p className="text-[14px] text-muted">{item.sub}</p>}
            </div>
            {onEdit && (
              <button type="button" aria-label={`Change: ${item.text}`} onClick={() => open(item)} className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
                <Pencil aria-hidden className="size-4" />
              </button>
            )}
          </li>
        );
      })}
      {onAdd && (adding ? <li>{editor}</li> : (
        <li>
          <button type="button" onClick={() => open(null)} className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line text-[14px] font-medium text-muted hover:text-text">
            <Plus aria-hidden className="size-4" />
            {addLabel}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A slider with the value in big type and an optional verdict under it ("Fair", "Generous"). */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  format,
  verdict,
  label,
  marks,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  verdict?: { text: string; tone: "low" | "ok" | "great" | "high" } | null;
  label: string;
  marks?: { value: number; label: string }[];
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-[34px] font-bold tabular-nums tracking-[-0.02em]">{format(value)}</p>
      {verdict && (
        <p
          className={cn(
            "mx-auto rounded-full px-3 py-1 text-[13px] font-semibold",
            verdict.tone === "low" ? "bg-danger-bg text-danger" : verdict.tone === "high" ? "bg-new-bg text-new" : "bg-success-bg text-success",
          )}
        >
          {verdict.text}
        </p>
      )}
      <input
        type="range"
        aria-label={label}
        aria-valuetext={format(value)}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full cursor-pointer accent-[var(--color-pulse-blue)]"
        style={{ background: `linear-gradient(90deg, var(--color-pulse-blue) ${pct}%, transparent ${pct}%)`, backgroundSize: "100% 6px", backgroundRepeat: "no-repeat", backgroundPosition: "center" }}
      />
      {marks && (
        <div className="flex justify-between gap-2">
          {marks.map((m) => (
            <button key={m.value} type="button" onClick={() => onChange(m.value)} className="cursor-pointer rounded-full bg-soft px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-text">
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The end of a quiz: the score ring, a line about what it means, and what to do next. */
export function ScoreRing({ percent, label }: { percent: number; label: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto size-40" role="img" aria-label={`${label}: ${pct}%`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-line)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="url(#bp-quiz-ring)" strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-1000 ease-out-soft" />
        <defs>
          <linearGradient id="bp-quiz-ring" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#2F6BFF" />
            <stop offset="1" stopColor="#7B5CFF" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[34px] font-bold tabular-nums">{pct}%</span>
      </span>
    </div>
  );
}
