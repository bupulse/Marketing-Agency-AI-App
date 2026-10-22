"use client";

// The wizard's inputs (docs/CREATOR_CAMPAIGN_WIZARD.md): cards, chips, a two-way switch, a stepper, money with its
// currency, tags, a search picker, a slider over fixed stops, a date range with presets. Mobile first: every target is
// at least 44px and each control says what it is to a screen reader.

import { Check, Minus, Plus, Search, Sparkles, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Chip } from "@/components/ui";
import { fieldBorder, fieldClasses } from "@/components/ui/field-styles";
import { cn } from "@/lib/cn";

/** A question inside a step: its label, a line under it, then the control. */
export function Question({ label, hint, children, className, id }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-[16px] font-semibold">
          {label}
        </h3>
        {hint && <p className="text-[14px] text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

type CardOption<T extends string> = { value: T; label: string; hint?: string; icon?: ReactNode; disabled?: boolean; badge?: string };

/** Big tappable cards, one picked (or several with `multiple`). */
export function ChoiceCards<T extends string>({ options, value, onChange, label, columns = 2, multiple = false }: { options: CardOption<T>[]; value: T | T[] | null; onChange: (v: T) => void; label: string; columns?: 1 | 2 | 3; multiple?: boolean }) {
  const on = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={label} className={cn("grid gap-2.5", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role={multiple ? undefined : "radio"}
          aria-checked={multiple ? undefined : on(o.value)}
          aria-pressed={multiple ? on(o.value) : undefined}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            on(o.value) ? "border-pulse-blue bg-ok-bg/60 shadow-ring" : "border-line bg-glass hover:bg-soft",
          )}
        >
          {o.icon && <span className={cn("mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl", on(o.value) ? "bg-brand-gradient text-white" : "bg-soft text-muted")}>{o.icon}</span>}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
              {o.label}
              {o.badge && <span className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-semibold text-muted">{o.badge}</span>}
            </span>
            {o.hint && <span className="text-[13px] text-muted">{o.hint}</span>}
          </span>
          {on(o.value) && <Check aria-hidden className="mt-1 size-5 shrink-0 text-pulse-blue" />}
        </button>
      ))}
    </div>
  );
}

/** Toggle chips: several picked. */
export function ChipGroup({ options, selected, onToggle, label }: { options: readonly (string | { value: string; label: string })[]; selected: string[]; onToggle: (v: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        return (
          <Chip key={v} selected={selected.includes(v)} onClick={() => onToggle(v)} className="px-4 py-2.5 text-[14px]">
            {typeof o === "string" ? o : o.label}
          </Chip>
        );
      })}
    </div>
  );
}

export const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** A two-or-more-way switch (one picked). */
export function Segmented<T extends string>({ options, value, onChange, label, disabled }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-soft p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn("min-h-11 shrink-0 cursor-pointer rounded-full px-3 text-[14px] font-semibold whitespace-nowrap transition-colors sm:px-4 disabled:cursor-not-allowed disabled:opacity-60", value === o.value ? "bg-brand-gradient text-white shadow-glow" : "text-muted hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** − 3 + */
export function Stepper({ value, min, max, onChange, label, unit, disabled }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; unit?: (n: number) => string; disabled?: boolean }) {
  const btn = "inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-line hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-3">
      <button type="button" aria-label={`Fewer: ${label}`} className={btn} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus aria-hidden className="size-4" />
      </button>
      <output aria-live="polite" className="min-w-16 text-center text-[17px] font-semibold tabular-nums">
        {unit ? unit(value) : value}
      </output>
      <button type="button" aria-label={`More: ${label}`} className={btn} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  );
}

const digits = (s: string) => s.replace(/[^\d]/g, "");
const grouped = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("en-US"));

/** A whole amount with its currency in front ("RWF 15,000"); empty is null. */
export function MoneyInput({ currency, value, onChange, placeholder, label, disabled, invalid, suffix }: { currency?: string; value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; label: string; disabled?: boolean; invalid?: boolean; suffix?: string }) {
  const id = useId();
  return (
    <div className={cn(fieldClasses, fieldBorder, "flex min-h-12 items-center gap-2 focus-within:border-pulse-blue focus-within:shadow-ring", invalid && "border-danger", disabled && "opacity-60")}>
      {currency && (
        <span aria-hidden className="shrink-0 text-[14px] font-semibold text-muted">
          {currency}
        </span>
      )}
      <input
        id={id}
        aria-label={label}
        inputMode="numeric"
        disabled={disabled}
        value={grouped(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const d = digits(e.target.value).slice(0, 10);
          onChange(d ? Number(d) : null);
        }}
        className="min-w-0 flex-1 bg-transparent py-3 text-[15px] tabular-nums outline-none placeholder:text-muted/80 disabled:cursor-not-allowed"
        // The box around it shows the focus (the global :focus-visible outline would draw a second one inside).
        style={{ outline: "none" }}
      />
      {suffix && <span className="shrink-0 text-[13px] text-muted">{suffix}</span>}
    </div>
  );
}

/** Typed values as removable chips; Enter, comma or space adds one. `suggestions` are one-tap chips. */
export function TagInput({ values, onChange, placeholder, label, suggestions = [], max = 10, normalize = (v: string) => v }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string; suggestions?: string[]; max?: number; normalize?: (v: string) => string }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(/[\s,]+/).map((p) => normalize(p.trim())).filter(Boolean);
    const next = [...values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p);
    onChange(next);
    setText("");
  };
  const left = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <div className={cn(fieldClasses, fieldBorder, "flex min-h-12 flex-wrap items-center gap-1.5 py-2 focus-within:border-pulse-blue focus-within:shadow-ring")}>
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-soft py-1 pr-1 pl-3 text-[14px] font-medium">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-glass hover:text-text">
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          value={text}
          placeholder={values.length ? "" : placeholder}
          autoCapitalize="off"
          onChange={(e) => (/[\s,]$/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) add(text);
            } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
          className="min-h-9 min-w-32 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/80"
          style={{ outline: "none" }}
        />
      </div>
      {left.length > 0 && values.length < max && (
        <div className="flex flex-wrap gap-2">
          {left.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line px-3.5 text-[14px] font-medium text-muted hover:bg-soft hover:text-text">
              <Plus aria-hidden className="size-3.5" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type PickOption = { id: string; label: string; hint?: string };

/** Search a list and pick (several with `multiple`); picked ones show as chips above. `free` keeps a typed value not listed. */
export function SearchPicker({ options, selected, onChange, placeholder, label, multiple = true, emptyText = "Nothing found.", search, free = false, max = 30 }: { options: PickOption[]; selected: string[]; onChange: (ids: string[]) => void; placeholder: string; label: string; multiple?: boolean; emptyText?: string; search?: (q: string) => PickOption[]; free?: boolean; max?: number }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const all = search ? search(q) : options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const results = all.slice(0, 8);
  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const pick = (id: string) => {
    if (!multiple) onChange(selected[0] === id ? [] : [id]);
    else onChange(selected.includes(id) ? selected.filter((x) => x !== id) : selected.length < max ? [...selected, id] : selected);
    setQ("");
    if (!multiple) setOpen(false);
  };
  const typed = q.trim();
  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Picked: ${label}`}>
          {selected.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-gradient py-1 pr-1 pl-3 text-[14px] font-medium text-white">
              {labelOf(id)}
              <button type="button" aria-label={`Remove ${labelOf(id)}`} onClick={() => onChange(selected.filter((x) => x !== id))} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-white/20">
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[0]) pick(results[0].id);
              else if (free && typed.length >= 2) pick(typed);
            }
          }}
          className={cn(fieldClasses, fieldBorder, "min-h-12 py-3 pl-10")}
        />
        {open && (
          <ul id={listId} role="listbox" aria-label={label} className="animate-pop absolute right-0 left-0 z-30 mt-1.5 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-glass">
            {results.map((o) => (
              <li key={o.id} role="option" aria-selected={selected.includes(o.id)}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.id)} className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-soft">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{o.label}</span>
                    {o.hint && <span className="truncate text-[13px] text-muted">{o.hint}</span>}
                  </span>
                  {selected.includes(o.id) && <Check aria-hidden className="size-4 text-pulse-blue" />}
                </button>
              </li>
            ))}
            {results.length === 0 && !(free && typed.length >= 2) && <li className="px-3 py-3 text-[14px] text-muted">{emptyText}</li>}
            {free && typed.length >= 2 && !results.some((r) => r.label.toLowerCase() === typed.toLowerCase()) && (
              <li role="option" aria-selected={false}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(typed)} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-[15px] hover:bg-soft">
                  <Plus aria-hidden className="size-4" /> Add &quot;{typed}&quot;
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A slider that stops at fixed values (`stops`), showing the one picked. */
export function StopSlider({ stops, value, onChange, label, format }: { stops: readonly number[]; value: number; onChange: (v: number) => void; label: string; format: (n: number) => string }) {
  const index = Math.max(0, stops.findIndex((s) => s >= value));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <output className="text-[17px] font-semibold tabular-nums">{format(stops[index])}</output>
      </div>
      <input type="range" aria-label={label} aria-valuetext={format(stops[index])} min={0} max={stops.length - 1} step={1} value={index} onChange={(e) => onChange(stops[Number(e.target.value)])} className="h-11 w-full cursor-pointer accent-[var(--color-pulse-blue)]" />
      <div className="flex justify-between text-[12px] text-muted">
        <span>{format(stops[0])}</span>
        <span>{format(stops[stops.length - 1])}</span>
      </div>
    </div>
  );
}

/** A plain number slider (1 to `max`). */
export function NumberSlider({ value, min, max, onChange, label, format }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; format: (n: number) => string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <output className="text-[17px] font-semibold tabular-nums">{format(value)}</output>
      <input type="range" aria-label={label} aria-valuetext={format(value)} min={min} max={max} step={1} value={Math.min(max, Math.max(min, value))} onChange={(e) => onChange(Number(e.target.value))} className="h-11 w-full cursor-pointer accent-[var(--color-pulse-blue)]" />
      <div className="flex justify-between text-[12px] text-muted">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

/** An on/off switch with its words. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-2xl border border-line bg-glass px-4 py-3 text-left hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60">
      <span aria-hidden className={cn("mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors", checked ? "bg-brand-gradient" : "bg-line")}>
        <span className={cn("size-6 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{label}</span>
        {hint && <span className="text-[13px] text-muted">{hint}</span>}
      </span>
    </button>
  );
}

/** "Suggest again": asks the AI for new ideas for this step (it never saves on its own). */
export function SuggestButton({ onClick, busy, label = "Suggest again" }: { onClick: () => void; busy: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-[14px] font-semibold text-text hover:bg-soft disabled:cursor-wait disabled:opacity-60">
      <Sparkles aria-hidden className={cn("size-4 text-pulse-violet", busy && "animate-pulse")} />
      {busy ? "Thinking…" : label}
    </button>
  );
}
