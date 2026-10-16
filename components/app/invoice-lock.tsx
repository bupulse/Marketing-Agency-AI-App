import Link from "next/link";
import { LogOut, MessageSquareText } from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { Badge, GlassCard } from "@/components/ui";
import { ClientInvoices } from "@/components/billing/client-invoices";
import { InvoicePay } from "@/components/billing/invoice-pay";
import { CheckoutScript } from "@/components/billing/checkout";
import { invoicePayMethods } from "@/lib/billing/card-ready";
import { site } from "@/lib/content/site";
import { MomoPayment } from "@/components/billing/momo-payment";
import { currentManualPayment } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured } from "@/lib/billing/momo-shared";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { clientInvoices, payableView } from "@/lib/invoices/service";
import { companyPlans } from "@/lib/region-prices";
import { getPlan } from "@/lib/plan-catalog";
import { can, type Role } from "@/lib/team/roles";

/**
 * What a company waiting for its demo sees once the admin chose "No trial, send invoice" (docs/INVOICES.md): the open
 * invoice and how to pay it, instead of the demo screen. Still read-only everywhere else (PENDING_DEMO, lib/entitlements.ts);
 * paying it makes the company ACTIVE on the invoice's plan and the dashboard opens. Only the Owner can pay.
 */
export async function InvoiceLock({ invoice, businessId, role, firstName, email, businessName }: { invoice: Prisma.InvoiceGetPayload<object>; businessId: string; role: Role; firstName: string; email: string; businessName: string }) {
  const canPay = can(role, "billing");
  const [business, { region }, momoSettings, list] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { userId: true } }),
    companyPlans(businessId),
    getMomoSettings(),
    canPay ? clientInvoices(businessId) : Promise.resolve([]),
  ]);
  const payment = canPay && business ? await currentManualPayment(business.userId) : null;
  const paying = payment?.status === "pending" && payment.invoiceId === invoice.id;
  const payable = await payableView(invoice);
  // A custom plan's invoice (docs/OFFERS.md) is not payable through card checkout.
  const custom = invoice.planKey ? (await getPlan(invoice.planKey))?.isCustom === true : false;
  const methods = await invoicePayMethods({ region, planKey: payable.planKey, interval: payable.interval, custom, momoConfigured: momoConfigured(momoSettings) });

  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center px-4 pb-10 sm:px-8">
      {canPay && methods.card === "ready" && <CheckoutScript />}
      <header className="relative flex w-full max-w-3xl items-center justify-between gap-3 py-4 sm:py-6">
        <Link href="/" aria-label="BuPulse home" className="inline-flex min-h-11 items-center">
          <Logo height={32} priority />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button type="submit" className="glass inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium">
              <LogOut aria-hidden className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="relative flex w-full max-w-3xl flex-1 flex-col gap-5">
        <GlassCard strong padding="lg" className="flex flex-col gap-3 p-6 sm:p-8">
          <Badge tone="violet" className="self-start">
            {businessName}
          </Badge>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">Your invoice is ready</h1>
          <p className="text-[15px] text-muted">
            Thanks for the demo, {firstName}. {canPay ? "Pay the invoice below and your dashboard opens as soon as the payment is confirmed, usually within minutes." : "Your company's owner pays it from their account; the dashboard opens as soon as the payment is confirmed."}
          </p>
        </GlassCard>

        {canPay && (paying && payment ? <MomoPayment payment={payment} details={momoSettings} /> : <InvoicePay invoice={payable} methods={methods} highlight cardReason={custom || !payable.planKey ? `Card for this invoice is set up by our team: ask us for a card link at ${site.email}.` : null} />)}
        {canPay && payment && !paying && payment.status !== "pending" && <MomoPayment payment={payment} details={momoSettings} />}
        {list.length > 0 && <ClientInvoices invoices={list} />}

        <p className="flex items-start gap-2 px-1 text-xs text-muted">
          <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0" />
          Signed in as {email}. Questions about the invoice? Reply to the invoice email.
        </p>
      </main>
    </div>
  );
}
