import {
  flatErrors,
  lookSchema,
  offerSchema,
  voiceSchema,
  validateKnowledge,
  type KnowledgeInput,
} from "@/lib/brand/schemas";
import { saveKnowledge, saveLook, saveOffer, saveVoice, type SaveResult } from "@/app/onboarding/actions";
import type { ContactType } from "@/lib/business-info/contacts";
import type { Schedule } from "@/lib/business-info/hours";
import type { LocationKind } from "@/lib/business-info/locations";

/** The four brand sections. Shared by /onboarding (as steps) and /dashboard/brand (as cards). */
export type StepId = "offer" | "voice" | "look" | "knowledge";

export type BrandValues = {
  description: string;
  audience: string;
  tone: string;
  logoPath: string | null;
  brandColors: string[];
  /** Structured opening hours (lib/business-info/hours.ts). */
  openingHours: Schedule[];
  /** Note on hours ("closed on public holidays"); the free-text hours of the first version. */
  hours: string;
  area: string;
  /** The head office first, then branches. */
  locations: LocationValue[];
  contacts: ContactValue[];
  /** The free-text contact of the first version, kept as a note until the owner clears it. */
  contact: string;
  faqs: { question: string; answer: string }[];
};

export type LocationValue = {
  kind: LocationKind;
  label: string;
  /** The searched address (or, when `manual`, rebuilt from street / area / city on save). */
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  /** "Inside a building or mall" and its fields. */
  inBuilding: boolean;
  building: { name: string; floor: string; block: string; unit: string };
  /** "Can't find it? Enter it yourself": street, area and city instead of the search. */
  manual: boolean;
  street: string;
  area: string;
  city: string;
};

export function emptyLocation(kind: LocationKind): LocationValue {
  return { kind, label: "", address: "", inBuilding: false, building: { name: "", floor: "", block: "", unit: "" }, manual: false, street: "", area: "", city: "" };
}
/** `value` is what is shown in the input; `country` is the phone country (a sign-up country name). */
export type ContactValue = { type: ContactType; value: string; country: string; primary: boolean };

export type Errors = Record<string, string>;

export const STEP_TITLES: Record<StepId, { title: string; short: string; description: string }> = {
  offer: { title: "What you sell", short: "What you sell", description: "A short description helps us write about your business the way you would." },
  voice: { title: "Brand voice", short: "Voice", description: "Pick how your posts should sound. You can change it any time." },
  look: { title: "Logo and colours", short: "Logo", description: "We use these on your designs. You can also add them later." },
  knowledge: { title: "Help your chat assistant", short: "Chat", description: "Your chat assistant answers visitors using only what you write here. All optional." },
};

/** The step 4 values the validator and the server action take. */
export function knowledgeInput(v: BrandValues): KnowledgeInput {
  return { hours: v.hours, area: v.area, contact: v.contact, faqs: v.faqs, openingHours: v.openingHours, locations: v.locations, contacts: v.contacts };
}

export function validateStep(step: StepId, v: BrandValues): Errors {
  const result =
    step === "offer"
      ? offerSchema.safeParse({ description: v.description, audience: v.audience })
      : step === "voice"
        ? voiceSchema.safeParse({ tone: v.tone })
        : step === "look"
          ? lookSchema.safeParse({ logoPath: v.logoPath ?? undefined, brandColors: v.brandColors })
          : null;
  if (!result) {
    const knowledge = validateKnowledge(knowledgeInput(v));
    return knowledge.ok ? {} : knowledge.errors;
  }
  return result.success ? {} : flatErrors(result.error);
}

export function saveStep(step: StepId, v: BrandValues): Promise<SaveResult> {
  switch (step) {
    case "offer":
      return saveOffer({ description: v.description, audience: v.audience });
    case "voice":
      return saveVoice({ tone: v.tone });
    case "look":
      return saveLook({ logoPath: v.logoPath, brandColors: v.brandColors });
    case "knowledge":
      return saveKnowledge(knowledgeInput(v));
  }
}

