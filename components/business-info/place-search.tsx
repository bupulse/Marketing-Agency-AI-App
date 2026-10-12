"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { mapsUrl } from "@/lib/business-info/locations";

type Suggestion = { placeId: string; main: string; secondary: string; text: string };
export type PickedPlace = { address: string; placeId: string; lat?: number; lng?: number; name: string };

function newSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Address box with Google Places suggestions, fetched through our own /api/places routes (the key stays on the
 * server). Typing always works as plain text; picking a suggestion adds the place id and coordinates. Without a
 * key (`enabled` false), or when the search fails, it is just a text input.
 */
export function PlaceSearch({
  label,
  address,
  placeId,
  lat,
  lng,
  enabled,
  required,
  error,
  placeholder = "Search for your address",
  onType,
  onPick,
}: {
  label: string;
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  enabled: boolean;
  required?: boolean;
  error?: string;
  placeholder?: string;
  onType: (address: string) => void;
  onPick: (place: PickedPlace) => void;
}) {
  const listId = `p${useId().replace(/:/g, "")}`;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [off, setOff] = useState(!enabled);
  const [notice, setNotice] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      request.current?.abort();
    },
    [],
  );

  function stop(message?: string) {
    setOff(true);
    setOpen(false);
    setSuggestions([]);
    if (message) setNotice(message);
  }

  function search(q: string) {
    if (timer.current) clearTimeout(timer.current);
    request.current?.abort();
    if (off || q.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      session.current ??= newSessionToken();
      const controller = new AbortController();
      request.current = controller;
      try {
        const res = await fetch(`/api/places/autocomplete?${new URLSearchParams({ q: q.trim(), session: session.current })}`, { signal: controller.signal });
        const body = (await res.json().catch(() => ({}))) as { enabled?: boolean; suggestions?: Suggestion[]; error?: string };
        if (!res.ok) return stop(body.error ?? "Address search is not available right now. Type the address instead.");
        if (body.enabled === false) return stop();
        setSuggestions(body.suggestions ?? []);
        setHighlight(-1);
        setOpen((body.suggestions ?? []).length > 0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") stop("Address search is not available right now. Type the address instead.");
      }
    }, 300);
  }

  async function pick(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    // Show the suggestion at once; the details call replaces it with the full formatted address.
    onType(s.text);
    const token = session.current;
    session.current = null; // the details request ends this billing session
    try {
      const res = await fetch(`/api/places/details?${new URLSearchParams({ id: s.placeId, ...(token ? { session: token } : {}) })}`);
      const body = (await res.json().catch(() => ({}))) as { place?: { address: string; placeId: string; lat?: number; lng?: number } };
      if (res.ok && body.place?.address) onPick({ ...body.place, name: s.main });
      else onPick({ address: s.text, placeId: s.placeId, name: s.main });
    } catch {
      onPick({ address: s.text, placeId: s.placeId, name: s.main });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown") setHighlight((h) => (h + 1) % suggestions.length);
    else if (e.key === "ArrowUp") setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    else if (e.key === "Enter" && highlight >= 0) void pick(suggestions[highlight]);
    else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  }

  const hint = notice ?? (off ? undefined : "Start typing and pick your address, or type it in full.");
  const showMap = address.trim().length > 0;

  return (
    <div className="relative flex flex-col gap-1.5">
      <Field label={label} required={required} error={error} hint={hint}>
        <Input
          type="text"
          autoComplete="street-address"
          maxLength={300}
          placeholder={placeholder}
          value={address}
          role={off ? undefined : "combobox"}
          aria-autocomplete={off ? undefined : "list"}
          aria-expanded={off ? undefined : open}
          aria-controls={off ? undefined : listId}
          aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
          onChange={(e) => {
            onType(e.target.value);
            search(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </Field>
      {!off && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          hidden={!open}
          className="glass-strong absolute inset-x-0 top-[calc(100%-4px)] z-20 mt-1 flex flex-col overflow-hidden rounded-2xl p-1 shadow-glass"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pick(s)}
              className={cn("flex min-h-11 cursor-pointer items-start gap-2 rounded-xl px-3 py-2 text-[14px]", i === highlight ? "bg-soft" : "hover:bg-soft")}
            >
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{s.main}</span>
                {s.secondary && <span className="block truncate text-[13px] text-muted">{s.secondary}</span>}
              </span>
            </li>
          ))}
          <li role="presentation" className="px-3 pb-1 pt-0.5 text-right text-[11px] text-muted">
            Powered by Google
          </li>
        </ul>
      )}
      {showMap && (
        <a
          href={mapsUrl({ address, placeId, lat, lng })}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-[14px] font-medium text-pulse-blue underline-offset-2 hover:underline"
        >
          <ExternalLink aria-hidden className="size-4" /> Open in Google Maps
        </a>
      )}
    </div>
  );
}
