// Business info (hours, locations, contacts) as text for the AI. Structured values win; the old free text of the
// first version stays readable as a note next to them, so nothing an owner wrote before is lost.
import type { Knowledge } from "@/lib/brand/schemas";
import { safeZone, localParts } from "@/lib/autopilot/timezone";
import { summarizeContacts } from "./contacts";
import { DAY_LONG, DAYS, describeOpenStatus, openStatus, summarizeHours } from "./hours";
import { summarizeLocations } from "./locations";

/** Hours, area and contact as one line each, for the marketing writers' calls to action. */
export function knowledgeFacts(k: Knowledge | null | undefined): { hours?: string; area?: string; contact?: string } {
  if (!k) return {};
  const join = (...parts: (string | undefined)[]) => parts.filter((p) => p?.trim()).join(". ") || undefined;
  const head = k.locations?.find((l) => l.kind === "head") ?? k.locations?.[0];
  return {
    hours: join(summarizeHours(k.openingHours ?? []), k.hours),
    area: join(k.area, head && !k.area ? head.address : undefined),
    contact: join(summarizeContacts(k.contacts ?? []), k.contact),
  };
}

/** Whether the owner gave any hours, locations or contacts. */
export function hasBusinessInfo(k: Knowledge): boolean {
  return !!(k.hours || k.area || k.contact || k.openingHours?.length || k.locations?.length || k.contacts?.length);
}

/**
 * The "OPENING HOURS, LOCATIONS AND CONTACTS" block of the website chat prompt, with the current local time so the
 * assistant can say "We're open now until 18:00". Small on purpose: about 10 short lines for a typical business.
 */
export function businessFactsContext(k: Knowledge, opts: { timeZone?: string | null; now?: Date } = {}): string | null {
  const zone = safeZone(opts.timeZone);
  const now = opts.now ?? new Date();
  const lines: string[] = [];
  const schedules = k.openingHours ?? [];
  if (schedules.length) {
    const p = localParts(now, zone);
    const clock = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    lines.push(`Opening hours (local time, ${zone}): ${summarizeHours(schedules)}.`);
    lines.push(`Right now it is ${DAY_LONG[DAYS[p.weekday]]} ${clock} there. ${describeOpenStatus(openStatus(schedules, zone, now))}`);
  }
  if (k.hours) lines.push(`${schedules.length ? "Note on hours" : "Opening hours"}: ${k.hours}`);
  // Token budget: the first six places (a typical business has one to three), addresses cut to 160 characters.
  const all = k.locations ?? [];
  const places = summarizeLocations(all.slice(0, 6));
  if (places.length) lines.push(...places.map((l) => `- ${l}`));
  if (all.length > 6) lines.push(`- and ${all.length - 6} more branches (ask the team for the full list)`);
  if (k.area) lines.push(`Area served: ${k.area}`);
  if (k.contacts?.length) lines.push(`Contacts: ${summarizeContacts(k.contacts)}.`);
  if (k.contact) lines.push(`${k.contacts?.length ? "Other contact details" : "Contact"}: ${k.contact}`);
  if (!lines.length) return null;
  return [
    "OPENING HOURS, LOCATIONS AND CONTACTS",
    ...lines,
    schedules.length ? "Days not listed in the opening hours are closed. Use the 'Right now' line for questions like \"are you open?\"." : null,
    places.length ? "When asked where the business is, give the address and its map link exactly as written." : null,
  ]
    .filter(Boolean)
    .join("\n");
}
