import { readKnowledge } from "@/lib/brand/schemas";
import { contactDisplay, countryNameForCode, isPhoneType, parseLegacyContact, phoneCountryCode } from "@/lib/business-info/contacts";
import { parseLegacyHours } from "@/lib/business-info/hours";
import { formatPhone, phoneCountry } from "@/lib/phone";
import { emptyLocation, type BrandValues, type ContactValue, type LocationValue } from "./steps";

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
  /** The phone from sign-up (E.164): the first contact until contacts are saved, so it is not typed twice. */
  phone?: string | null;
};

function signUpContact(phone: string | null | undefined, country: string): ContactValue {
  const number = phone?.trim();
  if (!number) return { type: "whatsapp", value: "", country, primary: true };
  return { type: "whatsapp_call", value: formatPhone(number), country: countryNameForCode(phoneCountryCode(number)) ?? country, primary: true };
}

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
  // Locations saved before building details and manual entry simply have neither.
  const toValue = (l: (typeof k.locations)[number]): LocationValue => ({
    ...emptyLocation(l.kind),
    label: l.label ?? "",
    address: l.address,
    placeId: l.placeId,
    lat: l.lat,
    lng: l.lng,
    inBuilding: !!l.building,
    building: { name: l.building?.name ?? "", floor: l.building?.floor ?? "", block: l.building?.block ?? "", unit: l.building?.unit ?? "" },
    manual: !!l.manual,
    street: l.manual?.street ?? "",
    area: l.manual?.area ?? "",
    city: l.manual?.city ?? "",
  });
  const locations: LocationValue[] = [head ? toValue(head) : emptyLocation("head"), ...k.locations.filter((l) => l.kind === "branch").map(toValue)];

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
    // A phone or WhatsApp number is required, so the editor starts with the sign-up phone as "WhatsApp + calls" (the
    // owner can change the type or the number), else an empty WhatsApp row (blank rows are ignored).
    contacts: contacts.length ? contacts : [signUpContact(b.phone, country)],
    contact: legacyContact ? legacyContact.rest : (k.contact ?? ""),
    faqs: k.faqs,
  };
}
