import Link from "next/link";
import { notFound } from "next/navigation";
import { Film } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { CARD, EmptyState, PageHeader, StatusPill } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { Field, Input } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import { finishedReels, type FinishedReel } from "@/lib/training-lab/from-result";
import { moreLikeThisAction, neverThisAction } from "../actions";
import { LabTabs } from "../lab-tabs";
import { PendingButton } from "../pending-button";

export const metadata = { title: "Training Lab finished reels" };
export const dynamic = "force-dynamic";

export default async function TrainingLabReelsPage({ searchParams }: PageProps<"/admin/training-lab/reels">) {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only, like the library; anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  const sp = await searchParams;
  const reels = await finishedReels().catch((): FinishedReel[] => []);
  return (
    <>
      <PageHeader icon={Film} tone="violet" title="Finished reels" description="The 20 newest reels the engine made, for every business. Your verdict becomes a Lab example with the video, so the reel engine makes more like it or never repeats it. The client's reel stays as it is." back={{ href: "/admin/training-lab", label: "Training Lab" }} />
      <LabTabs current="reels" />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <FinishedReels reels={reels} />
    </>
  );
}

/** The newest finished reels: the owner's verdict on each becomes a Lab example (the client's reel is not changed). */
function FinishedReels({ reels }: { reels: FinishedReel[] }) {
  return (
    <section id="finished-reels" aria-label="Finished reels" className="scroll-mt-24">
        {reels.length === 0 ? (
          <EmptyState icon={Film} title="No finished reels yet." hint="They appear here as the reel engine makes them." />
        ) : (
          <ul className="kit-rise grid min-w-0 items-start gap-3 lg:grid-cols-2">
            {reels.map((r) => (
              <li key={r.id} className={cn("flex min-w-0 flex-wrap items-center justify-between gap-3 p-4 sm:p-5", CARD)}>
                <div className="min-w-0">
                  <p className="break-words font-medium">{r.title}</p>
                  <p className="text-[13px] text-muted">{r.business} · {r.language} · {dateTime(r.createdAt)}</p>
                  <Link href={`/admin/training-lab/editor?reel=${encodeURIComponent(r.id)}`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-pulse-blue underline">Open in the editor</Link>
                </div>
                {r.inLab ? (
                  <StatusPill tone="good" dot>In the Lab</StatusPill>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <form action={moreLikeThisAction}>
                      <input type="hidden" name="reelId" value={r.id} />
                      <PendingButton label="More like this" pendingLabel="Copying the reel…" />
                    </form>
                    <ConfirmButton action={neverThisAction} fields={{ reelId: r.id }} label="Never this" title={`Never this: “${r.title}”?`} description="It becomes a 1-star example with your reason, and the engines never copy it." confirmLabel="Never this" pendingLabel="Saving…">
                      <Field label="What must never happen again" hint="One line, for example: the presenter walks through the product." required>
                        <Input name="reason" maxLength={300} required />
                      </Field>
                    </ConfirmButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
