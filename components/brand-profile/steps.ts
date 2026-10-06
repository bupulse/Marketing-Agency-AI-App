import {
  flatErrors,
  lookSchema,
  offerSchema,
  voiceSchema,
  validateKnowledge,
} from "@/lib/brand/schemas";
import { saveKnowledge, saveLook, saveOffer, saveVoice, type SaveResult } from "@/app/onboarding/actions";

/** The four brand sections. Shared by /onboarding (as steps) and /dashboard/brand (as cards). */
export type StepId = "offer" | "voice" | "look" | "knowledge";

export type BrandValues = {
  description: string;
  audience: string;
  tone: string;
  logoPath: string | null;
  brandColors: string[];
  hours: string;
  area: string;
  contact: string;
  faqs: { question: string; answer: string }[];
};

export type Errors = Record<string, string>;

export const STEP_TITLES: Record<StepId, { title: string; short: string; description: string }> = {
  offer: { title: "What you sell", short: "What you sell", description: "A short description helps us write about your business the way you would." },
  voice: { title: "Brand voice", short: "Voice", description: "Pick how your posts should sound. You can change it any time." },
  look: { title: "Logo and colours", short: "Logo", description: "We use these on your designs. You can also add them later." },
  knowledge: { title: "Help your chat assistant", short: "Chat", description: "Your chat assistant answers visitors using only what you write here. All optional." },
};

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
    const knowledge = validateKnowledge({ hours: v.hours, area: v.area, contact: v.contact, faqs: v.faqs });
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
      return saveKnowledge({ hours: v.hours, area: v.area, contact: v.contact, faqs: v.faqs });
  }
}

