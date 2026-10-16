"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus, Star, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { createReview, deleteReview, setReviewPublishable, updateReview } from "@/app/dashboard/knowledge/reviews/actions";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { emptyReview, MAX_REVIEWS, REVIEW_LIMITS, REVIEW_SOURCES, reviewInputSchema, SOURCE_LABEL, type ReviewFormValues, type ReviewInput, type ReviewSourceValue } from "@/lib/knowledge/reviews";

export type ReviewItem = { id: string; values: ReviewFormValues; productName: string | null };

const formatDay = (day: string) => (day ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)) : "");

/** Knowledge base -> Reviews & testimonials. Only reviews marked "may be quoted" ever reach the AI. */
export function ReviewEditor({ reviews, products, today, canEdit, canGrant }: { reviews: ReviewItem[]; products: { id: string; name: string }[]; today: string; canEdit: boolean; canGrant: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<ReviewItem | "new" | null>(null);
  const [confirming, setConfirming] = useState<ReviewItem | null>(null);
  const [pending, start] = useTransition();

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, after?: () => void) {
    start(async () => {
      const result = await task();
      if (!result.ok) return toast(result.error, "error");
      toast(done, "success");
      after?.();
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="reviews" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reviews" className="text-lg font-semibold tracking-[-0.02em]">
          Reviews
        </h2>
        {canEdit && (
          <Button size="sm" disabled={reviews.length >= MAX_REVIEWS} leading={<Plus aria-hidden className="size-4" />} onClick={() => setEditing("new")}>
            Add a review
          </Button>
        )}
      </div>
      {reviews.length === 0 ? (
        <GlassCard className="p-5 text-[15px] text-muted">
          Paste what happy customers said on Google, WhatsApp or in person. Tick &ldquo;The customer agreed to be quoted&rdquo; and BuPulse may quote it, word for word, in your posts.
        </GlassCard>
      ) : (
        <ul aria-label="Reviews" className="flex flex-col gap-3">
          {reviews.map((r) => (
            <li key={r.id}>
              <GlassCard className="flex flex-col gap-3 p-5">
                <blockquote className="text-[15px] whitespace-pre-line">&ldquo;{r.values.quote}&rdquo;</blockquote>
                <div className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
                  <span className="font-semibold text-text">{r.values.customerName}</span>
                  <span>· {SOURCE_LABEL[r.values.source as ReviewSourceValue] ?? r.values.source}</span>
                  {r.values.receivedOn && <span>· {formatDay(r.values.receivedOn)}</span>}
                  {typeof r.values.rating === "number" && (
                    <span className="inline-flex items-center gap-0.5" aria-label={`${r.values.rating} of 5 stars`}>
                      · {Array.from({ length: r.values.rating }, (_, i) => <Star key={i} aria-hidden className="size-3.5 fill-current" />)}
                    </span>
                  )}
                  {r.productName && <span>· about {r.productName}</span>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {r.values.canPublish ? <Badge tone="success">May be quoted in posts</Badge> : <Badge tone="neutral">Not quoted: no permission yet</Badge>}
                  {canEdit && (
                    <div className="flex flex-wrap gap-1">
                      {canGrant && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => setReviewPublishable(r.id, !r.values.canPublish), r.values.canPublish ? "BuPulse will no longer quote this review." : "BuPulse may now quote this review.")}
                      >
                        {r.values.canPublish ? "Withdraw permission" : "Customer agreed"}
                      </Button>
                      )}
                      <Button variant="ghost" size="sm" disabled={pending} leading={<PenLine aria-hidden className="size-4" />} onClick={() => setEditing(r)}>
                        Edit<span className="sr-only"> review by {r.values.customerName}</span>
                      </Button>
                      <Button variant="ghost" size="sm" disabled={pending} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirming(r)}>
                        Delete<span className="sr-only"> review by {r.values.customerName}</span>
                      </Button>
                    </div>
                  )}
                </div>
              </GlassCard>
            </li>
          ))}
        </ul>
      )}
      {editing && <ReviewDialog key={editing === "new" ? "new" : editing.id} review={editing === "new" ? null : editing} products={products} today={today} canGrant={canGrant} onClose={() => setEditing(null)} />}
      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)} title="Delete this review?" description="It will be removed and no longer quoted. This cannot be undone.">
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
            Keep it
          </Button>
          <Button disabled={pending} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => confirming && run(() => deleteReview(confirming.id), "Deleted.", () => setConfirming(null))}>
            Delete
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function ReviewDialog({ review, products, today, canGrant, onClose }: { review: ReviewItem | null; products: { id: string; name: string }[]; today: string; canGrant: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<ReviewFormValues>(review?.values ?? emptyReview(today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function set<K extends keyof ReviewFormValues>(key: K, value: ReviewFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function submit() {
    const check = reviewInputSchema(today).safeParse(values);
    if (!check.success) {
      setErrors(fieldErrorMap(check.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    start(async () => {
      const input = values as ReviewInput;
      const result = review ? await updateReview(review.id, input) : await createReview(input);
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        setFormError(result.error);
        return;
      }
      toast(review ? "Review saved." : "Review added.", "success");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={review ? "Edit review" : "Add a review"} description="Fields with * are required." className="max-w-2xl">
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="What the customer said" required error={errors.quote} hint="Exactly as they said it. BuPulse quotes it word for word, never reworded.">
          <Textarea rows={4} value={values.quote} maxLength={REVIEW_LIMITS.quote} onChange={(e) => set("quote", e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Customer name or initials" required error={errors.customerName} hint="As they agreed to be shown, e.g. “Aline M.”.">
            <Input value={values.customerName} maxLength={REVIEW_LIMITS.customerName} onChange={(e) => set("customerName", e.target.value)} />
          </Field>
          <Field label="Where it came from" required error={errors.source}>
            <Select value={values.source} onChange={(e) => set("source", e.target.value)}>
              <option value="">Choose…</option>
              {REVIEW_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rating (optional)" error={errors.rating}>
            <Select value={String(values.rating)} onChange={(e) => set("rating", e.target.value ? Number(e.target.value) : "")}>
              <option value="">No rating</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} star{n === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date (optional)" error={errors.receivedOn}>
            <Input type="date" value={values.receivedOn} max={today} onChange={(e) => set("receivedOn", e.target.value)} />
          </Field>
        </div>
        {products.length > 0 && (
          <Field label="About a product (optional)" error={errors.productId}>
            <Select value={values.productId} onChange={(e) => set("productId", e.target.value)}>
              <option value="">Not about one product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <label className="glass flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl p-4 text-[15px]">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-pulse-blue" checked={values.canPublish} disabled={!canGrant} onChange={(e) => set("canPublish", e.target.checked)} />
          <span>
            <span className="font-semibold">The customer agreed to be quoted</span>
            <span className="block text-[13px] text-muted">{canGrant ? "Required before BuPulse may use this review in posts. Without it, the review is kept for you only." : "Required before BuPulse may use this review in posts. Your company owner or an admin confirms it."}</span>
          </span>
        </label>
        {formError && (
          <p role="alert" className="text-[14px] font-medium text-danger">
            {formError}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {review ? "Save review" : "Add review"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
