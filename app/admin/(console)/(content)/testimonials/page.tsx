import Link from "next/link";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { EMPTY_TESTIMONIAL, TestimonialForm } from "@/components/admin/testimonial-form";
import { Badge, Button } from "@/components/ui";
import { param } from "@/lib/admin/format";
import { listTestimonialsAdmin } from "@/lib/testimonials/service";
import { STATE_BADGE, testimonialState } from "@/lib/testimonials/shared";
import { deleteTestimonialAction, moveTestimonialAction, setTestimonialPublishedAction } from "./actions";

export const metadata = { title: "Testimonials" };
export const dynamic = "force-dynamic";

export default async function TestimonialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const rows = await listTestimonialsAdmin();
  const live = rows.filter((r) => testimonialState(r) === "published").length;

  return (
    <>
      <PageHeader
        title="Testimonials"
        description="What real clients say about BuPulse. Shown on the home page and the pricing page only when at least one is published. Only publish words the client agreed to."
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel title="Add a testimonial" description="Ask the client first, and keep their message saying yes. A testimonial without “The client agreed to be shown” cannot be published.">
        <TestimonialForm initial={EMPTY_TESTIMONIAL} />
      </Panel>

      <Panel
        title={`Testimonials (${rows.length})`}
        description={live === 0 ? "None published: the home and pricing pages show no testimonials section." : `${live} on the site, in this order.`}
      >
        {rows.length === 0 ? (
          <Empty>No testimonials yet. Add the first one above once a client agrees.</Empty>
        ) : (
          <ol className="flex flex-col divide-y divide-line">
            {rows.map((t, i) => {
              const s = STATE_BADGE[testimonialState(t)];
              return (
                <li key={t.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    {t.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a small stored data URL
                      <img src={t.photoUrl} alt="" width={48} height={48} className="size-12 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span aria-hidden className="size-12 shrink-0 rounded-full bg-soft" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {t.clientName}, {t.business}
                        {t.sector ? <span className="font-normal text-muted"> · {t.sector}</span> : null} <Badge tone={s.tone}>{s.label}</Badge>
                      </p>
                      <p className="text-[14px] break-words">“{t.quote}”</p>
                      {t.result && <p className="text-[13px] font-semibold text-pulse-violet">{t.result}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <form action={moveTestimonialAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="direction" value="up" />
                      <Button type="submit" size="sm" variant="ghost" disabled={i === 0} aria-label={`Move ${t.clientName} up`}>Up</Button>
                    </form>
                    <form action={moveTestimonialAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="direction" value="down" />
                      <Button type="submit" size="sm" variant="ghost" disabled={i === rows.length - 1} aria-label={`Move ${t.clientName} down`}>Down</Button>
                    </form>
                    {t.consent && (
                      <form action={setTestimonialPublishedAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="published" value={t.published ? "false" : "true"} />
                        <Button type="submit" size="sm" variant="outline">{t.published ? "Hide" : "Publish"}</Button>
                      </form>
                    )}
                    <Link href={`/admin/testimonials/${encodeURIComponent(t.id)}`} className="inline-flex min-h-10 items-center px-2 text-sm font-semibold underline">Edit</Link>
                    <ConfirmButton
                      action={deleteTestimonialAction}
                      fields={{ id: t.id }}
                      label="Delete"
                      title={`Delete ${t.clientName}'s testimonial?`}
                      description="It leaves the site at once and is removed for good (written to the audit log)."
                      confirmLabel="Delete"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
