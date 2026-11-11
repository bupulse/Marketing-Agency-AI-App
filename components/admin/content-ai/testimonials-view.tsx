import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Quote, ShieldAlert } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Button, buttonClasses } from "@/components/ui";
import { cn } from "@/lib/cn";
import { testimonialState } from "@/lib/testimonials/shared";
import { deleteTestimonialAction, moveTestimonialAction, setTestimonialPublishedAction } from "@/app/admin/(console)/(content)/testimonials/actions";
import { CARD, EmptyState, PageHeader, StatGrid, StatTile, StatusPill, type PillTone } from "../kit";
import { notice } from "../ui";

export type TestimonialRow = { id: string; clientName: string; business: string; sector: string | null; quote: string; result: string | null; consent: boolean; published: boolean; photoUrl: string | null };

export const TESTIMONIAL_PILL: Record<ReturnType<typeof testimonialState>, { tone: PillTone; text: string }> = {
  published: { tone: "good", text: "On the site" },
  hidden: { tone: "muted", text: "Hidden" },
  no_consent: { tone: "bad", text: "No consent" },
};

/**
 * Testimonials: three numbers (on the site, hidden, without consent), "Add a testimonial" on its own page, and one
 * card per quote in site order with Up / Down, Publish or Hide, Edit and Delete.
 */
export function TestimonialsView({ rows, message }: { rows: TestimonialRow[]; message: { notice?: string; error?: string } }) {
  const by = (s: ReturnType<typeof testimonialState>) => rows.filter((r) => testimonialState(r) === s).length;
  const live = by("published");
  return (
    <>
      <PageHeader
        icon={Quote}
        tone="pink"
        title="Testimonials"
        description="What real clients say about BuPulse, on the home and pricing pages once at least one is published. Only publish words the client agreed to."
        actions={<Link href="/admin/testimonials/new" className={buttonClasses({ size: "md" })}><Plus aria-hidden className="size-4" /> Add a testimonial</Link>}
      />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}
      <StatGrid cols={3}>
        <StatTile icon={Eye} tone="pink" label="On the site" value={String(live)} hint={live === 0 ? "None: the site shows no testimonials section." : "Shown in the order below."} />
        <StatTile icon={EyeOff} tone="pink" label="Hidden" value={String(by("hidden"))} hint="Agreed, but not shown right now." />
        <StatTile icon={ShieldAlert} tone="pink" label="No consent yet" value={String(by("no_consent"))} alert={by("no_consent") > 0} hint="Cannot be published until the client agrees." className="max-lg:col-span-2" />
      </StatGrid>
      {rows.length === 0 ? (
        <EmptyState icon={Quote} title="No testimonials yet." hint="Add the first one once a client agrees to be shown." action={<Link href="/admin/testimonials/new" className={buttonClasses({ size: "sm" })}>Add a testimonial</Link>} />
      ) : (
        <ol aria-label="Testimonials, in site order" className="kit-rise grid items-start gap-3 lg:grid-cols-2">
          {rows.map((t, i) => {
            const s = TESTIMONIAL_PILL[testimonialState(t)];
            return (
              <li key={t.id} className={cn("flex min-w-0 flex-col gap-3 p-4 sm:p-5", CARD)}>
                <div className="flex min-w-0 items-start gap-3">
                  {t.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small stored data URL
                    <img src={t.photoUrl} alt="" width={48} height={48} className="size-12 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7b5cff,#b18cff)] text-[17px] font-bold text-white">{t.clientName.trim().charAt(0).toUpperCase()}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold">{t.clientName}</p>
                    <p className="truncate text-[13px] text-muted">{t.business}{t.sector ? ` · ${t.sector}` : ""}</p>
                  </div>
                  <span className="flex flex-col items-end gap-1">
                    <StatusPill tone={s.tone} dot>{s.text}</StatusPill>
                    <span className="text-[11.5px] font-semibold text-muted">No. {i + 1}</span>
                  </span>
                </div>
                <blockquote className="break-words rounded-2xl bg-soft/70 px-3.5 py-3 text-[14px] leading-relaxed dark:bg-white/[0.04]">“{t.quote}”</blockquote>
                {t.result && <p className="text-[13px] font-semibold text-pulse-violet">{t.result}</p>}
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <form action={moveTestimonialAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button type="submit" size="sm" variant="ghost" disabled={i === 0} aria-label={`Move ${t.clientName} up`} leading={<ArrowUp aria-hidden className="size-4" />}>Up</Button>
                  </form>
                  <form action={moveTestimonialAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button type="submit" size="sm" variant="ghost" disabled={i === rows.length - 1} aria-label={`Move ${t.clientName} down`} leading={<ArrowDown aria-hidden className="size-4" />}>Down</Button>
                  </form>
                  <span className="flex-1" />
                  {t.consent && (
                    <form action={setTestimonialPublishedAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="published" value={t.published ? "false" : "true"} />
                      <Button type="submit" size="sm" variant="outline">{t.published ? "Hide" : "Publish"}</Button>
                    </form>
                  )}
                  <Link href={`/admin/testimonials/${encodeURIComponent(t.id)}`} className={buttonClasses({ variant: "outline", size: "sm" })}>Edit</Link>
                  <ConfirmButton action={deleteTestimonialAction} fields={{ id: t.id }} label="Delete" title={`Delete ${t.clientName}'s testimonial?`} description="It leaves the site at once and is removed for good (written to the audit log)." confirmLabel="Delete" />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
