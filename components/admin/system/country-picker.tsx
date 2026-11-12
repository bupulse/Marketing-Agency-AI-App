"use client";

import { Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ISO_COUNTRIES, ISO_COUNTRY_CODES } from "@/lib/iso-countries";

/**
 * The countries of a region (Admin -> Regions -> a region): the chosen ones as chips with a remove button, and a search
 * over every ISO country (name or code) to add more. A country another region lists says so ("In West Africa"); adding
 * it moves it here when the form is saved (the hidden `move` field tells the server the admin chose that). Posts one
 * `countries` field per code. No package: the list is lib/iso-countries.ts.
 */
export function CountryPicker({ name = "countries", initial, taken, regionName }: { name?: string; initial: string[]; taken: Record<string, string>; regionName: string }) {
  const [chosen, setChosen] = useState<string[]>(initial);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      ISO_COUNTRY_CODES.filter((c) => !chosen.includes(c))
        .filter((c) => !q || c.toLowerCase() === q || ISO_COUNTRIES[c].toLowerCase().includes(q))
        .sort((a, b) => Number(b.toLowerCase() === q) - Number(a.toLowerCase() === q) || ISO_COUNTRIES[a].localeCompare(ISO_COUNTRIES[b])),
    [chosen, q],
  );
  const moving = chosen.filter((c) => taken[c]);
  const add = (code: string) => setChosen((list) => (list.includes(code) ? list : [...list, code]));
  const remove = (code: string) => setChosen((list) => list.filter((c) => c !== code));

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-[14px] font-semibold">Countries ({chosen.length})</legend>
      {chosen.map((c) => (
        <input key={c} type="hidden" name={name} value={c} />
      ))}
      {moving.length > 0 && <input type="hidden" name="move" value="1" />}
      {chosen.length === 0 ? (
        <p className="rounded-2xl bg-soft px-3 py-2.5 text-[13px] text-muted">No country yet. Search below and add at least one.</p>
      ) : (
        <ul aria-label={`Countries in ${regionName}`} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {[...chosen].sort((a, b) => ISO_COUNTRIES[a]?.localeCompare(ISO_COUNTRIES[b] ?? b) ?? 0).map((c) => (
            <li key={c}>
              <span className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border-2 py-0.5 pr-1 pl-2.5 text-[13px] font-semibold", taken[c] ? "border-new/60 bg-new-bg" : "border-line bg-soft/60")}>
                <span className="rounded bg-surface px-1 font-mono text-[11px] text-muted">{c}</span>
                {ISO_COUNTRIES[c] ?? c}
                {taken[c] && <span className="text-[11.5px] font-normal text-muted">moves from {taken[c]}</span>}
                <button type="button" onClick={() => remove(c)} aria-label={`Remove ${ISO_COUNTRIES[c] ?? c}`} className="inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-danger-bg hover:text-danger focus-visible:ring-4 focus-visible:ring-pulse-blue/30 focus-visible:outline-none">
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {moving.length > 0 && (
        <p role="status" className="rounded-2xl bg-new-bg px-3 py-2.5 text-[13px]">
          Saving moves {moving.map((c) => ISO_COUNTRIES[c] ?? c).join(", ")} here from {[...new Set(moving.map((c) => taken[c]))].join(" and ")}. A country belongs to one region.
        </p>
      )}
      <label className="relative block">
        <span className="sr-only">Search countries</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the first match instead of submitting the form.
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[0]) {
                add(results[0]);
                setQuery("");
              }
            }
          }}
          placeholder="Search a country or code, e.g. Nigeria or NG"
          className="min-h-11 w-full rounded-xl border-2 border-line bg-surface pr-3 pl-9 text-[15px] outline-none focus:border-pulse-blue focus-visible:ring-4 focus-visible:ring-pulse-blue/20"
        />
      </label>
      <ul aria-label="Countries to add" className="m-0 max-h-64 list-none overflow-y-auto rounded-2xl border border-line p-1">
        {results.slice(0, 80).map((c) => (
          <li key={c}>
            <button type="button" onClick={() => add(c)} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[14px] hover:bg-soft focus-visible:bg-soft focus-visible:ring-4 focus-visible:ring-pulse-blue/30 focus-visible:outline-none">
              <span className="w-7 shrink-0 font-mono text-[12px] text-muted">{c}</span>
              <span className="min-w-0 flex-1 truncate">{ISO_COUNTRIES[c]}</span>
              {taken[c] && <span className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-[11.5px] text-muted">In {taken[c]}</span>}
              <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-pulse-blue">
                <Plus aria-hidden className="size-3.5" /> {taken[c] ? "Move here" : "Add"}
              </span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No country matches.</li>}
        {results.length > 80 && <li className="px-3 py-2 text-[12.5px] text-muted">{results.length - 80} more: type to narrow the list.</li>}
      </ul>
    </fieldset>
  );
}
