import Link from "next/link";
import { Globe, Layers, Plus, Repeat, Users } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader, StatGrid, StatTile } from "@/components/admin/kit";
import { PlansGrid } from "@/components/admin/business/money-plans";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { buttonClasses } from "@/components/ui";
import { money, num } from "@/lib/admin/format";
import { listAdminPlans } from "@/lib/admin/plans-service";

export const metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function PlansPage({ searchParams }: PageProps<"/admin/plans">) {
  await requirePermission("plans.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const { plans, paddleConnected } = await listAdminPlans();
  const totalMrr = plans.reduce((s, p) => s + p.mrrCents, 0);
  const paying = plans.reduce((s, p) => s + p.payingSubscribers, 0);

  return (
    <>
      <PageHeader
        icon={Layers}
        tone="green"
        title="Plans"
        description="What clients can buy. The pricing page, checkout, limits and Jarvis all read these plans. Open one to change it."
        actions={
          <>
            <Link href="/admin/settings/regions" className={buttonClasses({ size: "md", variant: "outline" })}>
              <Globe aria-hidden className="size-4" /> Regions
            </Link>
            <Link href="/admin/plans/new" className={buttonClasses({ size: "md" })}>
              <Plus aria-hidden className="size-4" /> New plan
            </Link>
          </>
        }
      />
      <MoneyNotices sp={sp} />
      {!paddleConnected && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">
          <strong>Paddle not connected.</strong> Plans can be drafted and edited, but nothing is created in Paddle and prices of plans that already sell cannot change until Paddle is connected in <Link href="/admin/settings#paddle" className="underline">Settings → Card payments</Link>.
        </p>
      )}
      <StatGrid cols={3} className="grid-cols-1 sm:grid-cols-3">
        <StatTile icon={Repeat} tone="green" label="MRR from plans" value={money(totalMrr)} href="/admin/revenue" hint="What paying clients bring in a month, at today's plan prices." />
        <StatTile icon={Users} tone="blue" label="Paying clients" value={num(paying)} hint="On a paid plan now (active or late paying)." />
        <StatTile icon={Layers} tone="green" label="Plans" value={num(plans.length)} hint={`${plans.filter((p) => p.status === "active").length} on sale, the rest hidden or retired.`} />
      </StatGrid>
      <PlansGrid plans={plans} />
    </>
  );
}
