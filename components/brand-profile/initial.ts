import { readKnowledge } from "@/lib/brand/schemas";
import type { BrandValues } from "./steps";

type BusinessProfile = {
  description: string | null;
  audience: string | null;
  tone: string | null;
  logoUrl: string | null;
  brandColors: string[];
  knowledge: unknown;
};

/** Form values for the brand sections, from the saved Business row. */
export function initialValues(b: BusinessProfile): BrandValues {
  const k = readKnowledge(b.knowledge);
  return {
    description: b.description ?? "",
    audience: b.audience ?? "",
    tone: b.tone ?? "",
    logoPath: b.logoUrl,
    brandColors: b.brandColors,
    hours: k.hours ?? "",
    area: k.area ?? "",
    contact: k.contact ?? "",
    faqs: k.faqs,
  };
}
