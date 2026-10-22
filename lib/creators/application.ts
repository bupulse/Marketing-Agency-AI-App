// The application form of /c/<slug> (docs/CREATOR_CAMPAIGNS.md, "Applying"; the form the company builds,
// docs/CREATOR_CAMPAIGN_WIZARD.md), read and checked. Pure, so the form's rules have tests; lib/creators/apply.ts saves
// it, lib/creators/quick-apply.ts reads the same fields for one-tap applying.

import { parsePhone, phoneCountry } from "@/lib/phone";
import type { CampaignQuestion } from "./company-forms";
import { readAnswer, readApplicationForm, type Answer, type ApplicationForm, type FormField, type Show } from "./form-fields";
import { SOCIAL_LABEL, SOCIAL_NETWORKS, type SocialNetwork } from "./networks";

/** One of the creator's accounts: any network (views are counted on the tracked ones only, lib/creators/networks.ts). */
export type Handle = { network: SocialNetwork; handle: string; followers: number };
export type Application = { name: string; email: string; phone: string | null; handles: Handle[]; samples: string[]; answers: Record<string, Answer> };
export type ApplicationErrors = Partial<Record<string, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_SAMPLES = 3;
export const ANSWER_MAX = 1000;

/** "@ana.rw", "ana.rw" or a profile link -> "ana.rw". */
export function cleanHandle(raw: string): string {
  let v = raw.trim();
  try {
    if (/^https?:\/\//i.test(v)) v = new URL(v).pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {}
  return v.replace(/^@+/, "").replace(/\s+/g, "").slice(0, 60);
}

/** "12k", "1.5M", "12,300" -> a whole number; null when unreadable. */
export function readFollowers(raw: string): number | null {
  const v = raw.trim().toLowerCase().replace(/[,\s]/g, "");
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(n) && n <= 2_000_000_000 ? Math.floor(n) : null;
}

/** A WhatsApp number: international ("+254…") as written, otherwise in the company's country. E.164 or null. */
export function readWhatsapp(raw: string, companyCountry: string | null | undefined): string | null {
  const v = raw.trim();
  if (!v) return null;
  return (v.startsWith("+") ? parsePhone(v, null) : parsePhone(v, phoneCountry(companyCountry) ?? "RW"))?.number ?? null;
}

/** An http(s) link with a real host name. */
export const isLink = (v: string) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
};

/** A posted form: FormData, or a Map in the tests (no getAll: one value per name). */
export type FormLike = { get(name: string): unknown; getAll?(name: string): unknown[] };

const all = (form: FormLike, name: string): string[] => (form.getAll ? form.getAll(name) : [form.get(name)]).filter((v) => v !== null && v !== undefined).map((v) => String(v));

/** The required-but-empty message of every field (the same words as the questions before the wizard). */
export const ANSWER_REQUIRED = "Please answer this question.";

/** The form names of a field: `q_<id>`, and for ranges `q_<id>.min`/`q_<id>.max` (money) or `q_<id>.from`/`q_<id>.to` (dates). */
export const answerName = (id: string) => `q_${id}`;
export const rangeNames = (field: Pick<FormField, "id" | "type">): [string, string] | null =>
  field.type === "MONEY_RANGE" ? [`q_${field.id}.min`, `q_${field.id}.max`] : field.type === "DATE_RANGE" ? [`q_${field.id}.from`, `q_${field.id}.to`] : null;

/** True when the form sent anything for this field (a quick application leaves out what the profile answers). */
export function sentField(form: FormLike, field: Pick<FormField, "id" | "type">): boolean {
  const names = rangeNames(field) ?? [answerName(field.id)];
  return names.some((n) => form.get(n) !== null && form.get(n) !== undefined);
}

/** One field's answer from the form (readAnswer, with the range parts read in); its error goes in `errors` under `q_<id>`. */
export function readField(form: FormLike, field: FormField, errors: ApplicationErrors): Answer | null {
  const range = rangeNames(field);
  const read = readAnswer(field, all(form, answerName(field.id)), range ? { a: String(form.get(range[0]) ?? ""), b: String(form.get(range[1]) ?? "") } : undefined);
  if (read.ok) return read.value;
  errors[answerName(field.id)] = read.error === "Please answer this." ? ANSWER_REQUIRED : read.error;
  return null;
}

/** The answers to the form's own fields, by field id (empty optional ones left out). */
export function readFields(form: FormLike, fields: FormField[], errors: ApplicationErrors): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const field of fields) {
    const value = readField(form, field, errors);
    if (value !== null) answers[field.id] = value;
  }
  return answers;
}

/** The form campaigns had before the wizard: the questions as fields, a WhatsApp number and a best post required. */
export function legacyForm(questions: CampaignQuestion[]): ApplicationForm {
  return { ...readApplicationForm(null, questions), samples: "REQUIRED" };
}

/** First and last name ("Ana Marie Uwase" -> "Ana Marie", "Uwase"), for prefilling from one name. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { firstName: words[0] ?? "", lastName: "" };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

/** The name: First name and Last name (the form since the wizard), or one `name` box (before it). */
export function readName(form: FormLike, errors: ApplicationErrors): string {
  const s = (name: string) => String(form.get(name) ?? "").trim();
  if (form.get("firstName") == null && form.get("lastName") == null) {
    const name = s("name").slice(0, 100);
    if (name.length < 2) errors.name = "Enter your name.";
    return name;
  }
  const first = s("firstName").slice(0, 50);
  const last = s("lastName").slice(0, 50);
  if (!first) errors.firstName = "Enter your first name.";
  if (!last) errors.lastName = "Enter your last name.";
  return `${first} ${last}`.trim();
}

const PHONE_ERROR = "Enter a valid WhatsApp number, e.g. +250 791 954 277.";

/** The WhatsApp number as the form shows it: required, optional (checked when given) or not asked (null). */
export function readPhone(raw: string, show: Show, country: string | null | undefined, errors: ApplicationErrors): string | null {
  if (show === "HIDDEN") return null;
  const phone = readWhatsapp(raw, country);
  if (!phone && (show === "REQUIRED" || raw.trim())) errors.phone = PHONE_ERROR;
  return phone;
}

/** Links to their best posts, `sample_1..3`, as the form shows them. */
export function readSamples(form: FormLike, show: Show, errors: ApplicationErrors): string[] {
  if (show === "HIDDEN") return [];
  const samples = [1, 2, 3].map((i) => String(form.get(`sample_${i}`) ?? "").trim()).filter(Boolean).slice(0, MAX_SAMPLES);
  if (!samples.length && show === "REQUIRED") errors.sample_1 = "Add a link to one of your best posts.";
  samples.forEach((v, i) => {
    if (!isLink(v) || v.length > 500) errors[`sample_${i + 1}`] = "Paste the full link, starting with https://";
  });
  return samples;
}

/**
 * The social accounts: every network the creator ticked (`networks`) or typed a username for, with `handle_<network>`
 * and `followers_<network>`. At least one, on any network: the company sees which are on the campaign's platforms.
 */
export function readSocials(form: FormLike, errors: ApplicationErrors): Handle[] {
  const s = (name: string) => String(form.get(name) ?? "").trim();
  const ticked = new Set(all(form, "networks"));
  const handles: Handle[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const handle = network === "linkedin" ? cleanProfile(s(`handle_${network}`)) : cleanHandle(s(`handle_${network}`));
    const followersRaw = s(`followers_${network}`);
    if (!ticked.has(network) && !handle && !followersRaw) continue;
    if (!handle) {
      errors[`handle_${network}`] = `Enter your ${SOCIAL_LABEL[network]} username.`;
      continue;
    }
    const followers = readFollowers(followersRaw);
    if (followers === null) {
      errors[`followers_${network}`] = "Enter how many followers you have, e.g. 12000 or 12k.";
      continue;
    }
    handles.push({ network, handle, followers });
  }
  if (!handles.length && !Object.keys(errors).some((k) => k.startsWith("handle_") || k.startsWith("followers_"))) errors.handles = "Add at least one of your accounts.";
  return handles;
}

/** A LinkedIn profile: its link kept whole (the name in it is not the profile's first path part), or the name typed. */
function cleanProfile(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v.slice(0, 200);
  return v.replace(/^@+/, "").replace(/\s+/g, " ").slice(0, 60);
}

/**
 * Reads the application form of a campaign: its built form (`form`, docs/CREATOR_CAMPAIGN_WIZARD.md), or without one
 * the form campaigns had before the wizard (`questions`). Either the application, or the errors per field. UPLOAD
 * answers are storage paths: the server checks they are this campaign's uploads (lib/creators/application-uploads.ts).
 */
export function readApplication(
  form: FormLike,
  campaign: { platforms: string[]; questions: CampaignQuestion[]; country: string | null; form?: ApplicationForm },
): { ok: true; value: Application } | { ok: false; errors: ApplicationErrors } {
  const built = campaign.form ?? legacyForm(campaign.questions);
  const errors: ApplicationErrors = {};
  const name = readName(form, errors);
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL.test(email)) errors.email = "Enter a valid email address. It becomes your login.";
  const phone = readPhone(String(form.get("phone") ?? ""), built.phone, campaign.country, errors);
  const handles = readSocials(form, errors);
  const samples = readSamples(form, built.samples, errors);
  const answers = readFields(form, built.fields, errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, phone, handles, samples, answers } };
}

/** The answers to the company's own questions (`q_<id>` fields); a missing required one adds its error to `errors`. */
export function readAnswers(form: { get(name: string): unknown }, questions: CampaignQuestion[], errors: ApplicationErrors): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const a = String(form.get(`q_${q.id}`) ?? "").trim().slice(0, ANSWER_MAX);
    if (q.required && !a) errors[`q_${q.id}`] = "Please answer this question.";
    if (a) answers[q.id] = a;
  }
  return answers;
}
