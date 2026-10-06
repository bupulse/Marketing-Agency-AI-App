"use client";

import { MAX_ONBOARDING_FAQS } from "@/lib/brand/schemas";
import { KnowledgeFields } from "./knowledge-fields";
import { LookFields } from "./look-fields";
import { OfferFields } from "./offer-fields";
import type { BrandValues, Errors, StepId } from "./steps";
import { VoicePicker } from "./voice-picker";

export type StepContext = {
  businessName: string;
  industry: string | null;
  savedLogoUrl: string | null;
};

/** The fields of one brand section. Used by the onboarding steps and by the Brand page cards. */
export function StepFields({
  step,
  values,
  errors,
  onChange,
  onBusyChange,
  context,
  maxFaqs = MAX_ONBOARDING_FAQS,
}: {
  step: StepId;
  values: BrandValues;
  errors: Errors;
  onChange: (patch: Partial<BrandValues>) => void;
  onBusyChange: (busy: boolean) => void;
  context: StepContext;
  maxFaqs?: number;
}) {
  switch (step) {
    case "offer":
      return <OfferFields values={values} errors={errors} onChange={onChange} />;
    case "voice":
      return <VoicePicker values={values} errors={errors} onChange={onChange} businessName={context.businessName} industry={context.industry} />;
    case "look":
      return <LookFields values={values} errors={errors} onChange={onChange} onBusyChange={onBusyChange} savedLogoUrl={context.savedLogoUrl} />;
    case "knowledge":
      return <KnowledgeFields values={values} errors={errors} onChange={onChange} maxFaqs={maxFaqs} />;
  }
}
