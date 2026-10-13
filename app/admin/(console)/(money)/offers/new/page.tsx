import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { OfferEditor } from "@/components/admin/offer-editor";
import { Panel, notice } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/types";
import { featureLabel } from "@/lib/features";
import { offerEditorContext } from "@/lib/offers/service";
import { budgetLabel } from "@/lib/offers/shared";

export const metadata = { title: "Customise plan" };
export const dynamic = "force-dynamic";

// "Customise plan" from the company page (Client 360) or a plan request (?request=), which prefills the features.
export default async function NewOfferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const businessId = param(sp.businessId).slice(0, 64);
  if (!businessId) notFound();
  let ctx;
  try {
    ctx = await offerEditorContext({ businessId, requestId: param(sp.request).slice(0, 64) || null });
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        title={`Customise plan: ${ctx.business.name}`}
        description={`Region ${ctx.region.name} (${ctx.region.currency}). Now on ${ctx.current.planName} (${ctx.current.status.toLowerCase().replace("_", " ")}).`}
        action={<Link href={`/admin/companies/${ctx.business.id}`} className="glass inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium no-underline">Back to the company</Link>}
      />
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {ctx.request && (
        <Panel title="What they asked for" description={budgetLabel(ctx.request.budget) ? `Budget: ${budgetLabel(ctx.request.budget)}` : undefined}>
          <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
            <div><dt className="text-[13px] text-muted">The business</dt><dd className="whitespace-pre-line">{ctx.request.description}</dd></div>
            <div><dt className="text-[13px] text-muted">Goals</dt><dd className="whitespace-pre-line">{ctx.request.goals}</dd></div>
            <div className="sm:col-span-2"><dt className="text-[13px] text-muted">Interested in</dt><dd>{ctx.request.features.map(featureLabel).join(", ") || "Not said"}</dd></div>
          </dl>
        </Panel>
      )}
      <OfferEditor businessId={ctx.business.id} offerId={null} region={ctx.region} bases={ctx.bases} prices={ctx.prices} initial={ctx.initial} ownerEmail={ctx.business.ownerEmail} now={new Date().toISOString()} />
    </>
  );
}
