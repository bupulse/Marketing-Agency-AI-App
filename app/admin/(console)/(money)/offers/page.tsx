import Link from "next/link";
import { Sparkles, Tags } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { OffersList } from "@/components/admin/business/money-offers";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { buttonClasses } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listOffers } from "@/lib/offers/service";
import { isOfferStatus } from "@/lib/offers/shared";

export const metadata = { title: "Offers" };
export const dynamic = "force-dynamic";

export default async function OffersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("requests"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const status = isOfferStatus(param(sp.status)) ? param(sp.status) : "";
  const businessId = param(sp.businessId).slice(0, 64);
  const offers = await listOffers({ status: status || undefined, businessId: businessId || undefined });

  return (
    <>
      <PageHeader
        icon={Sparkles}
        tone="green"
        title="Offers"
        description="Custom plans offered to one company, made from the company page (Customise plan) or a plan request. The client accepts on Billing and pays; confirming the payment switches the plan on."
        actions={
          <Link href="/admin/addon-prices" className={buttonClasses({ variant: "outline" })}>
            <Tags aria-hidden className="size-4" /> Add-on prices
          </Link>
        }
      />
      <MoneyNotices sp={sp} />
      <OffersList offers={offers} status={status} businessId={businessId} sp={sp} now={new Date()} />
    </>
  );
}
