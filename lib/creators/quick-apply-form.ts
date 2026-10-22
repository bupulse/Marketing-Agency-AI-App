// One-tap applying with a creator account against the company's built form (docs/CREATOR_MARKETPLACE.md, "Creator
// accounts"; docs/CREATOR_CAMPAIGN_WIZARD.md, "Marketplace one-tap apply"). Pure: what the profile answers, what is
// left to ask, and reading the short form. Owner decision: the profile fills the form (the creator can change the
// basics); they answer only what the profile cannot. With nothing left, it stays one tap.

import { readField, readName, readPhone, readSamples, sentField, splitName, type ApplicationErrors, type FormLike } from "./application";
import type { Answer, ApplicationForm, FormField } from "./form-fields";

/** What a creator's profile holds for an application. */
export type ApplyingProfile = { name: string; phone: string | null; location: string | null; samples: string[] };

/** The profile's answer to a field, or null: the "location" preset from the profile's district or city. */
export function profileAnswer(field: FormField, profile: Pick<ApplyingProfile, "location">): Answer | null {
  if (field.preset === "location" && (field.type === "LOCATION" || field.type === "SHORT_TEXT") && profile.location?.trim()) return profile.location.trim().slice(0, 200);
  return null;
}

/**
 * What the short form must ask: the required fields the profile cannot answer, the best posts when they are required
 * and the profile has none, and the optional fields (shown folded, never needed). Nothing in `fields` and no
 * `samples`: one tap.
 */
export function quickApplyAsks(form: ApplicationForm, profile: ApplyingProfile): { fields: FormField[]; optional: FormField[]; samples: boolean } {
  const open = form.fields.filter((f) => profileAnswer(f, profile) === null);
  return {
    fields: open.filter((f) => f.required),
    optional: open.filter((f) => !f.required),
    samples: form.samples === "REQUIRED" && profile.samples.length === 0,
  };
}

export type QuickApplication = { name: string; phone: string | null; samples: string[]; answers: Record<string, Answer> };

/**
 * The application from the profile and the short form: what the form sent wins (the creator changed it or answered
 * it), the profile fills the rest. Errors per field, as on the public form.
 */
export function readQuickApplication(
  posted: FormLike,
  form: ApplicationForm,
  profile: ApplyingProfile,
  country: string | null,
): { ok: true; value: QuickApplication } | { ok: false; errors: ApplicationErrors } {
  const errors: ApplicationErrors = {};
  const sent = (name: string) => posted.get(name) !== null && posted.get(name) !== undefined;
  const name = sent("firstName") || sent("lastName") ? readName(posted, errors) : profile.name;
  const phone = form.phone === "HIDDEN" ? null : sent("phone") ? readPhone(String(posted.get("phone") ?? ""), form.phone, country, errors) : profile.phone;
  if (form.phone === "REQUIRED" && !phone && !errors.phone) errors.phone = "Enter a valid WhatsApp number, e.g. +250 791 954 277.";
  const samples = form.samples === "HIDDEN" ? [] : sent("sample_1") ? readSamples(posted, form.samples, errors) : profile.samples.slice(0, 3);
  if (form.samples === "REQUIRED" && !samples.length && !errors.sample_1) errors.sample_1 = "Add a link to one of your best posts.";
  const answers: Record<string, Answer> = {};
  for (const field of form.fields) {
    const own = profileAnswer(field, profile);
    const value = sentField(posted, field) || own === null ? readField(posted, field, errors) : own;
    if (value !== null) answers[field.id] = value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, phone, samples, answers } };
}

/** The profile's name as the short form shows it. */
export const prefillName = (profile: Pick<ApplyingProfile, "name">) => splitName(profile.name);
