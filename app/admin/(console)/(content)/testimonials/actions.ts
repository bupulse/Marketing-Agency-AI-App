"use server";

import { redirect } from "next/navigation";
import { adminAction, actionMessage, finish } from "@/lib/admin/console";
import { createTestimonial, deleteTestimonial, moveTestimonial, setTestimonialPublished, updateTestimonial, type TestimonialSave } from "@/lib/testimonials/service";

const BACK = "/admin/testimonials";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Each action re-checks the person and the "content" permission (adminAction): server actions are public POST
// endpoints. Every change is audited by the service.

function inputOf(f: FormData): TestimonialSave {
  return {
    clientName: text(f, "clientName"),
    business: text(f, "business"),
    sector: text(f, "sector"),
    quote: text(f, "quote"),
    result: text(f, "result"),
    consent: f.get("consent") === "on",
    published: f.get("published") === "on",
    // Base64 of the 160 x 160 JPEG the browser made (a few KB), never the original file.
    photo: text(f, "photo") || null,
    removePhoto: f.get("removePhoto") === "on",
  };
}

export type TestimonialFormState = { error?: string };

/** Add or edit. On success the list opens with a notice; on a problem the form stays filled with the message. */
export async function saveTestimonialAction(_prev: TestimonialFormState, f: FormData): Promise<TestimonialFormState> {
  const ctx = await adminAction("content");
  const id = text(f, "id");
  let notice: string;
  try {
    const row = id ? await updateTestimonial(ctx, id, inputOf(f)) : await createTestimonial(ctx, inputOf(f));
    notice = `${row.clientName}'s testimonial ${id ? "saved" : "added"}${row.published ? " and published" : ""}.`;
  } catch (e) {
    return { error: actionMessage(e) };
  }
  redirect(`${BACK}?notice=${encodeURIComponent(notice)}`);
}

export async function setTestimonialPublishedAction(f: FormData) {
  const ctx = await adminAction("content");
  const published = f.get("published") === "true";
  await finish(BACK, (r) => `${r.clientName}'s testimonial is ${published ? "on the site" : "hidden"}.`, () => setTestimonialPublished(ctx, text(f, "id"), published));
}

export async function moveTestimonialAction(f: FormData) {
  const ctx = await adminAction("content");
  const direction = text(f, "direction") === "up" ? "up" : "down";
  await finish(BACK, (r) => `${r.clientName} moved ${direction}.`, () => moveTestimonial(ctx, text(f, "id"), direction));
}

export async function deleteTestimonialAction(f: FormData) {
  const ctx = await adminAction("content");
  await finish(BACK, (r) => `${r.clientName}'s testimonial deleted.`, () => deleteTestimonial(ctx, text(f, "id")));
}
