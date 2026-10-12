"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Chip, Field, Input } from "@/components/ui";

/** Adds a line: trimmed, spaces collapsed, no duplicates (ignoring case), at most `max`. */
export function addLine(items: string[], raw: string, max: number, each: number): string[] {
  const value = raw.trim().replace(/\s+/g, " ").slice(0, each);
  if (!value || items.length >= max || items.some((i) => i.toLowerCase() === value.toLowerCase())) return items;
  return [...items, value];
}

/**
 * A list of short lines (selling points, features, values...): type, press Enter or "Add", remove with the x.
 * `suggestions` are offered as toggle chips (languages). A line typed but not added yet is added on blur, so it is
 * never lost when the form is saved.
 */
export function ListField({
  label,
  hint,
  items,
  onChange,
  max,
  each = 160,
  placeholder,
  error,
  required,
  addLabel = "Add",
  suggestions,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (items: string[]) => void;
  max: number;
  each?: number;
  placeholder?: string;
  error?: string;
  required?: boolean;
  addLabel?: string;
  suggestions?: readonly string[];
}) {
  const [draft, setDraft] = useState("");
  const full = items.length >= max;

  function commit() {
    onChange(addLine(items, draft, max, each));
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={`${label}${max > 1 ? ` (up to ${max})` : ""}`} hint={hint} error={error} required={required}>
        <Input
          value={draft}
          maxLength={each}
          disabled={full}
          placeholder={full ? "Limit reached" : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() && commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Common ${label.toLowerCase()}`}>
          {suggestions.map((s) => {
            const on = items.some((i) => i.toLowerCase() === s.toLowerCase());
            return (
              <Chip key={s} selected={on} onClick={() => onChange(on ? items.filter((i) => i.toLowerCase() !== s.toLowerCase()) : addLine(items, s, max, each))} className="px-4 py-2">
                {s}
              </Chip>
            );
          })}
        </div>
      )}
      <div>
        <Button variant="ghost" size="sm" disabled={!draft.trim() || full} onClick={commit} leading={<Plus aria-hidden className="size-4" />}>
          {addLabel}
        </Button>
      </div>
      {items.length > 0 && (
        <ul aria-label={label} className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item} className="glass inline-flex min-h-11 max-w-full items-center gap-1 rounded-full py-1 pr-1 pl-4 text-[15px]">
              <span className="break-words">{item}</span>
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((x) => x !== item))}
                className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
