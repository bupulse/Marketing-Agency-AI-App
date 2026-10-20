"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { notice } from "@/components/admin/ui";
import { saveTestimonialAction, type TestimonialFormState } from "@/app/admin/(console)/(content)/testimonials/actions";
import { LIMITS, PHOTO_MAX_BYTES, PHOTO_SIDE } from "@/lib/testimonials/shared";

export type TestimonialFormValues = {
  id?: string | null;
  clientName: string;
  business: string;
  sector: string | null;
  quote: string;
  result: string | null;
  consent: boolean;
  published: boolean;
  photoUrl: string | null;
};

export const EMPTY_TESTIMONIAL: TestimonialFormValues = { clientName: "", business: "", sector: "", quote: "", result: "", consent: false, published: false, photoUrl: null };

/**
 * The chosen photo as a 160 x 160 JPEG, cropped to the centre square, as base64. Made in the browser so the server
 * action gets a few KB (well under its 1 MB limit) and never the original file. Transparent parts become white.
 */
async function squarePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIDE;
  canvas.height = PHOTO_SIDE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("no canvas");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, PHOTO_SIDE, PHOTO_SIDE);
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    if (base64.length * 0.75 <= PHOTO_MAX_BYTES) return base64;
  }
  throw new Error("too big");
}

/** Add / edit form for one testimonial. Posts to saveTestimonialAction (permission re-checked there, audited). */
export function TestimonialForm({ initial }: { initial: TestimonialFormValues }) {
  const [state, action, pending] = useActionState<TestimonialFormState, FormData>(saveTestimonialAction, {});
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const editing = Boolean(initial.id);
  const preview = photo ? `data:image/jpeg;base64,${photo}` : removePhoto ? null : initial.photoUrl;

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPhotoError(null);
    if (!file) return;
    try {
      setPhoto(await squarePhoto(file));
      setRemovePhoto(false);
    } catch {
      setPhoto(null);
      setPhotoError("This photo could not be read. Choose a JPEG or PNG photo.");
    }
    e.target.value = ""; // the file itself is never sent; choosing the same one again still works
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {photo && <input type="hidden" name="photo" value={photo} />}
      {state.error && <p role="alert" className={notice.bad}>{state.error}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Client's name" required hint="As they agreed to be named, for example Aline M.">
          <Input name="clientName" defaultValue={initial.clientName} maxLength={LIMITS.clientName} required />
        </Field>
        <Field label="Business" required>
          <Input name="business" defaultValue={initial.business} maxLength={LIMITS.business} required />
        </Field>
        <Field label="Sector" hint="Optional, for example Bakery, Kigali.">
          <Input name="sector" defaultValue={initial.sector ?? ""} maxLength={LIMITS.sector} />
        </Field>
      </div>
      <Field label="Their words" required hint={`${LIMITS.quoteMin} to ${LIMITS.quote} characters, exactly as the client said or wrote them.`}>
        <Textarea name="quote" defaultValue={initial.quote} rows={3} minLength={LIMITS.quoteMin} maxLength={LIMITS.quote} required />
      </Field>
      <Field label="Result" hint="Optional, highlighted on the card. A real number the client confirmed, for example 12 orders on WhatsApp in a week.">
        <Input name="result" defaultValue={initial.result ?? ""} maxLength={LIMITS.result} />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Photo (optional)</span>
        <div className="flex flex-wrap items-center gap-4">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small data URL made in the browser or stored
            <img src={preview} alt="" width={64} height={64} className="size-16 rounded-full object-cover" />
          ) : (
            <span aria-hidden className="grid size-16 place-items-center rounded-full bg-soft text-xs text-muted">No photo</span>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4 text-sm font-semibold">
            {preview ? "Change photo" : "Choose a photo"}
            <input type="file" accept="image/*" onChange={choose} className="sr-only" />
          </label>
          {photo && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setPhoto(null)}>
              Don&apos;t use this photo
            </Button>
          )}
          {editing && initial.photoUrl && !photo && (
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="removePhoto" checked={removePhoto} onChange={(e) => setRemovePhoto(e.target.checked)} className="size-4" /> Remove photo
            </label>
          )}
        </div>
        <p className="text-[13px] text-muted">Cropped to a square and made small ({PHOTO_SIDE} x {PHOTO_SIDE}) before it is sent. Only with the client&apos;s agreement.</p>
        {photoError && <p role="alert" className="text-sm text-danger">{photoError}</p>}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="consent" defaultChecked={initial.consent} className="size-4" /> The client agreed to be shown
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="published" defaultChecked={initial.published} className="size-4" /> Published (shown on the home and pricing pages)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save testimonial" : "Add testimonial"}
        </Button>
        {editing && (
          <Link href="/admin/testimonials" className="inline-flex min-h-11 items-center text-sm font-medium underline">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
