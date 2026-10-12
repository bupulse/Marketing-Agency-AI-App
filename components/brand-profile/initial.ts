import { readKnowledge } from "@/lib/brand/schemas";
import { contactDisplay, countryNameForCode, isPhoneType, parseLegacyContact, phoneCountryCode } from "@/lib/business-info/contacts";
import { parseLegacyHours } from "@/lib/business-info/hours";
import { phoneCountry } from "@/lib/phone";
import type { BrandValues, ContactValue, LocationValue } from "./steps";

type BusinessProfile = {
  description: string | null;
  /** "Describe your business" from sign-up: the first draft of the onboarding description. */
  industryDescription?: string | null;
  audience: string | null;
  tone: string | null;
  logoUrl: string | null;
  brandColors: string[];
  knowledge: unknown;
  /** Sign-up country name: the default phone country of new contacts. */
  country?: string | null;
};

/**
 * Form values for the brand sections, from the saved Business row. Free-text hours and contacts from the first
 * version are turned into the structured editors when they can be read ("Mon to Sat, 9am to 6pm"); otherwise
 * they stay as notes. Nothing changes in the database until the owner saves.
 */
export function initialValues(b: BusinessProfile): BrandValues {
  const k = readKnowledge(b.knowledge);
  const country = b.country ?? "";

  const legacyHours = k.openingHours.length ? null : parseLegacyHours(k.hours);
  const legacyContact = k.contacts.length ? null : parseLegacyContact(k.contact, phoneCountry(country));
  const contacts: ContactValue[] = k.contacts.length
    ? k.contacts.map((c) => ({
        type: c.type,
        value: c.type === "website" ? c.value : contactDisplay(c),
        country: isPhoneType(c.type) ? (countryNameForCode(phoneCountryCode(c.value)) ?? country) : country,
        primary: !!c.primary,
      }))
    : (legacyContact?.contacts ?? []).map((c) => ({ type: c.type, value: contactDisplay(c), country: countryNameForCode(phoneCountryCode(c.value)) ?? country, primary: !!c.primary }));

  const head = k.locations.find((l) => l.kind === "head");
  const toValue = (l: (typeof k.locations)[number]): LocationValue => ({ kind: l.kind, label: l.label ?? "", address: l.address, placeId: l.placeId, lat: l.lat, lng: l.lng });
  const locations: LocationValue[] = [head ? toValue(head) : { kind: "head", label: "", address: "" }, ...k.locations.filter((l) => l.kind === "branch").map(toValue)];

  return {
    description: b.description ?? b.industryDescription ?? "",
    audience: b.audience ?? "",
    tone: b.tone ?? "",
    logoPath: b.logoUrl,
    brandColors: b.brandColors,
    openingHours: k.openingHours.length ? k.openingHours : (legacyHours ?? []),
    hours: legacyHours ? "" : (k.hours ?? ""),
    area: k.area ?? "",
    locations,
    contacts,
    contact: legacyContact ? legacyContact.rest : (k.contact ?? ""),
    faqs: k.faqs,
  };
}
