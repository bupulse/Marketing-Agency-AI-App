// What a company has that its link-in-bio page can show (BioSource), from the Knowledge base: the name and tagline,
// the contacts, locations and opening hours of Business info (docs/BUSINESS_INFO.md), and its active products. Pure:
// the caller loads the rows and the image addresses.
import type { StoredKnowledge } from "@/lib/brand/schemas";
import { canCall, canWhatsApp, contactDisplay, contactHref } from "@/lib/business-info/contacts";
import { liveTimeZone } from "@/lib/business-info/facts";
import { describeOpenStatus, openStatus, summarizeHours } from "@/lib/business-info/hours";
import { HEAD_OFFICE_LABEL, locationText, mapsUrl } from "@/lib/business-info/locations";
import { priceLine, type PriceFields } from "@/lib/knowledge/products";
import { BIO_LINK_TYPES, type BioLinkType, type BioSource } from "./view";

export type BioSourceInput = {
  name: string;
  tagline: string | null;
  description: string | null;
  accent: string;
  knowledge: StoredKnowledge;
  timezone: string | null;
  logoUrl: string | null;
  products: (PriceFields & { id: string; name: string; summary: string; photoUrl: string | null })[];
  now?: Date;
};

const unique = <T>(rows: T[], key: (row: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];

export function bioSource(input: BioSourceInput): BioSource {
  const k = input.knowledge;
  const contacts = [...k.contacts].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  const numbers = (keep: (type: (typeof contacts)[number]["type"]) => boolean) =>
    unique(contacts.filter((c) => keep(c.type)).map((c) => ({ value: c.value, display: contactDisplay(c) })), (n) => n.value);

  const schedules = k.openingHours.filter((s) => s.days.length);
  const zone = liveTimeZone(input.timezone);
  const status = schedules.length && zone ? openStatus(schedules, zone, input.now) : null;
  const lines = [...(schedules.length ? summarizeHours(schedules).split(" · ") : []), ...(k.hours ? [k.hours] : [])];

  return {
    name: input.name,
    defaultTagline: input.tagline?.trim() || input.description?.trim() || "",
    accent: input.accent,
    logoUrl: input.logoUrl,
    whatsappNumbers: numbers(canWhatsApp),
    phoneNumbers: numbers(canCall),
    locations: unique(
      k.locations
        .filter((l) => l.address.trim())
        .map((l) => ({ address: l.address, label: l.label?.trim() || (l.kind === "head" ? HEAD_OFFICE_LABEL : "Branch"), text: locationText(l), mapsUrl: l.mapsUrl ?? mapsUrl(l) })),
      (l) => l.address,
    ),
    hours: lines.length ? { lines, status: status?.known ? describeOpenStatus(status) : null, open: status?.known ? status.open : null } : null,
    links: BIO_LINK_TYPES.flatMap((type: BioLinkType) => {
      const c = contacts.find((x) => x.type === type);
      return c ? [{ type, href: contactHref(c), display: contactDisplay(c) }] : [];
    }),
    products: input.products.map((p) => ({ id: p.id, name: p.name, price: priceLine(p), summary: p.summary, photoUrl: p.photoUrl })),
  };
}
