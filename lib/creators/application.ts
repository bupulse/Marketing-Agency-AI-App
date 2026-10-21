// The application form of /c/<slug> (docs/CREATOR_CAMPAIGNS.md, "Applying"), read and checked. Pure, so the form's
// rules have tests; lib/creators/apply.ts saves it.

import { parsePhone, phoneCountry } from "@/lib/phone";
import { isCreatorNetwork, networkLabel, type CreatorNetwork } from "./describe";

export type Question = { id: string; label: string; required: boolean };
export type Handle = { network: CreatorNetwork; handle: string; followers: number };
export type Application = { name: string; email: string; phone: string; handles: Handle[]; samples: string[]; answers: Record<string, string> };
export type ApplicationErrors = Partial<Record<string, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_SAMPLES = 3;
export const ANSWER_MAX = 1000;

/** The company's own questions as stored (Json): anything unreadable is left out. */
export function readQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
    .map((q) => ({ id: String(q.id ?? "").slice(0, 40), label: String(q.label ?? "").trim().slice(0, 300), required: q.required === true }))
    .filter((q) => /^[A-Za-z0-9_-]+$/.test(q.id) && q.label)
    .slice(0, 20);
}

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

const isLink = (v: string) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
};

/** Reads the form for a campaign with these platforms and questions. Either the application, or the errors per field. */
export function readApplication(
  form: { get(name: string): unknown },
  campaign: { platforms: string[]; questions: Question[]; country: string | null },
): { ok: true; value: Application } | { ok: false; errors: ApplicationErrors } {
  const s = (name: string) => String(form.get(name) ?? "").trim();
  const errors: ApplicationErrors = {};
  const name = s("name").slice(0, 100);
  if (name.length < 2) errors.name = "Enter your name.";
  const email = s("email").toLowerCase().slice(0, 200);
  if (!EMAIL.test(email)) errors.email = "Enter a valid email address. It becomes your login.";
  const phone = readWhatsapp(s("phone"), campaign.country);
  if (!phone) errors.phone = "Enter a valid WhatsApp number, e.g. +250 791 954 277.";

  const handles: Handle[] = [];
  for (const network of campaign.platforms.filter(isCreatorNetwork)) {
    const handle = cleanHandle(s(`handle_${network}`));
    const followersRaw = s(`followers_${network}`);
    if (!handle && !followersRaw) continue;
    if (!handle) {
      errors[`handle_${network}`] = `Enter your ${networkLabel(network)} name.`;
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

  const samples = [1, 2, 3].map((i) => s(`sample_${i}`)).filter(Boolean).slice(0, MAX_SAMPLES);
  if (!samples.length) errors.sample_1 = "Add a link to one of your best posts.";
  samples.forEach((v, i) => {
    if (!isLink(v) || v.length > 500) errors[`sample_${i + 1}`] = "Paste the full link, starting with https://";
  });

  const answers: Record<string, string> = {};
  for (const q of campaign.questions) {
    const a = s(`q_${q.id}`).slice(0, ANSWER_MAX);
    if (q.required && !a) errors[`q_${q.id}`] = "Please answer this question.";
    if (a) answers[q.id] = a;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, phone: phone!, handles, samples, answers } };
}
