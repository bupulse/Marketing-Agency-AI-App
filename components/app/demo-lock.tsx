import Link from "next/link";
import { CalendarCheck, CalendarClock, CalendarPlus, ExternalLink, LogOut, MessageSquareText, Sparkles, Video } from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { Badge, Button, GlassCard, buttonClasses } from "@/components/ui";
import { formatPrice } from "@/components/billing/helpers";
import { MomoPayment } from "@/components/billing/momo-payment";
import { getSettings } from "@/lib/admin/settings";
import { currentManualPayment } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured, momoPriceOf } from "@/lib/billing/momo-shared";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/auth/site-url";
import { currentBooking } from "@/lib/demo/bookings";
import { demoGoogleCalendarUrl } from "@/lib/demo/calendar-links";
import { DEMO_TIME_ZONE, formatSlot, MIN_LEAD_MINUTES } from "@/lib/demo/slots";
import { companyPlans } from "@/lib/region-prices";
import { can, type Role } from "@/lib/team/roles";
import { DemoCancelButton } from "./demo-cancel";
import { DemoPayButton } from "./demo-pay";
import { OfferCard } from "@/components/billing/offer-card";
import { OfferActions } from "@/components/billing/offer-actions";
import { clientOffer } from "@/lib/offers/service";
import { site } from "@/lib/content/site";

/** Reschedule and cancel are only offered up to MIN_LEAD_MINUTES before the call (lib/demo/bookings.ts enforces it too). */
const canStillMove = (booking: { startsAt: Date }) => booking.startsAt.getTime() - Date.now() >= MIN_LEAD_MINUTES * 60_000;

/**
 * What a company sees instead of the dashboard while it waits for its demo (Subscription.status PENDING_DEMO): the
 * booking, the meeting link, reschedule / cancel, the plan it chose and what happens next. Nothing else is shown,
 * and the server refuses everything else too (lib/entitlements.ts, lib/usage.ts).
 */
export async function DemoLock({ businessId, role, firstName, email, businessName }: { businessId: string; role: Role; firstName: string; email: string; businessName: string }) {
  const canManage = can(role, "settings");
  const [booking, settings, { region, plans }, business, momoSettings] = await Promise.all([
    currentBooking(businessId),
    getSettings(),
    companyPlans(businessId),
    prisma.business.findUnique({ where: { id: businessId }, select: { userId: true, user: { select: { subscription: { select: { chosenPlan: true } } } } } }),
    getMomoSettings(),
  ]);
  const chosenKey = business?.user.subscription?.chosenPlan ?? null;
  const plan = chosenKey ? plans.find((p) => p.key === chosenKey) ?? null : null;
  // Paying by Mobile Money does not have to wait for the demo: where the region takes it and the owner has said where
  // to pay, the chosen plan can be paid from here; confirming makes the company ACTIVE and opens the dashboard.
  const canPay = canManage && plan !== null && region.paymentMethods.includes("momo") && momoConfigured(momoSettings) && momoPriceOf(plan, "MONTH") !== null;
  const payment = canManage && business ? await currentManualPayment(business.userId) : null;
  // A custom plan offer sent before or after the demo (docs/OFFERS.md): paying it opens the dashboard like any plan.
  const canBill = can(role, "billing");
  const offer = canBill ? await clientOffer(businessId).catch(() => null) : null;
  const momoOn = region.paymentMethods.includes("momo") && momoConfigured(momoSettings);
  const meetingLink = booking?.meetingLink || settings.meetingLink || null;
  const googleUrl = booking ? demoGoogleCalendarUrl({ ...booking, meetingLink }, businessName, `${siteUrl()}/dashboard`) : null;
  const movable = booking ? canStillMove(booking) : false;
  const zone = DEMO_TIME_ZONE.replace("_", " ");

  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center px-4 pb-10 sm:px-8">
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
        <GlassCard strong padding="lg" className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <Badge tone="violet" className="self-start">
              {businessName}
            </Badge>
            {booking ? (
              <>
                <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">
                  Your demo is on {formatSlot(booking.startsAt)}
                </h1>
                <p className="text-[15px] text-muted">
                  Time in {zone}. Welcome, {firstName}. In about {Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000)} minutes we look at your business together and show you what BuPulse makes for it. The dashboard opens after the demo.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">Book your free demo</h1>
                <p className="text-[15px] text-muted">
                  Welcome, {firstName}. {canManage ? "Pick a time that suits you; the dashboard opens after the demo." : "Your company's owner or an admin picks the time; the dashboard opens after the demo."}
                </p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {booking && meetingLink && (
              <a href={meetingLink} target="_blank" rel="noreferrer noopener" className={buttonClasses({ size: "lg" })}>
                <Video aria-hidden className="size-[18px]" /> Join the meeting
                <ExternalLink aria-hidden className="size-4" />
              </a>
            )}
            {booking && googleUrl && (
              <a href={googleUrl} target="_blank" rel="noreferrer noopener" className={buttonClasses({ variant: "outline", size: "lg" })}>
                <CalendarPlus aria-hidden className="size-[18px]" /> Add to Google Calendar
              </a>
            )}
            {booking && (
              <a href={`/api/demo/ics/${encodeURIComponent(booking.icsToken)}`} className={buttonClasses({ variant: "outline", size: "lg" })}>
                <CalendarCheck aria-hidden className="size-[18px]" /> Add to Apple / Outlook (.ics)
              </a>
            )}
            {!booking && canManage && (
              <Button href="/book-demo?step=time" size="lg" leading={<CalendarClock aria-hidden className="size-[18px]" />}>
                Pick a time
              </Button>
            )}
          </div>
          {booking && meetingLink && (
            <p className="text-sm text-muted">
              {booking.meetLink ? "Google Meet" : "Meeting link"}:{" "}
              <a href={meetingLink} target="_blank" rel="noreferrer noopener" className="break-all font-medium text-text underline">
                {meetingLink}
              </a>
              {booking.googleEventId ? ". Google Calendar has also sent the invite to your email." : ""}
            </p>
          )}
          {booking && !meetingLink && <p className="text-sm text-muted">The meeting link arrives by email before the call.</p>}

          {booking && canManage && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              {movable ? (
                <>
                  <Link href="/book-demo?step=time" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                    Reschedule
                  </Link>
                  <DemoCancelButton when={formatSlot(booking.startsAt)} />
                  <span className="text-xs text-muted">You can reschedule or cancel up to {MIN_LEAD_MINUTES / 60} hours before the call.</span>
                </>
              ) : (
                <span className="text-sm text-muted">The call starts in less than {MIN_LEAD_MINUTES / 60} hours, so it can no longer be moved here. Need to change it? Reply to your booking email.</span>
              )}
            </div>
          )}
        </GlassCard>

        {offer && (
          <OfferCard
            offer={offer}
            actions={offer.status === "sent" || (offer.status === "accepted" && !(payment?.status === "pending" && payment.submitted)) ? <OfferActions offerId={offer.id} momo={momoOn} card={region.paymentMethods.includes("card")} accepted={offer.status === "accepted"} method={offer.payMethod} contactEmail={site.email} /> : undefined}
          />
        )}

        {payment && <MomoPayment payment={payment} details={momoSettings} />}

        {canBill && !offer && (
          <p className="px-1 text-sm text-muted">
            Need something different from the plans?{" "}
            <Link href="/custom-plan?from=demo" className="font-semibold underline">
              Request a custom plan
            </Link>{" "}
            and we will talk it through in the demo.
          </p>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <GlassCard as="section" aria-labelledby="chosen-plan" className="flex flex-col gap-3 p-5 sm:p-6">
            <h2 id="chosen-plan" className="text-base font-semibold">
              The plan you chose
            </h2>
            {plan ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <strong className="text-xl tracking-[-0.02em]">{plan.name}</strong>
                  <span className="text-sm text-muted">
                    {formatPrice(plan.monthlyPriceCents, plan.currency)} / month
                    {plan.card ? ` · ${formatPrice(plan.card.monthlyUsdCents, "USD")} by card` : ""}
                  </span>
                </div>
                <p className="text-sm text-muted">{plan.description}</p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {plan.highlights.slice(0, 4).map((h) => (
                    <li key={h} className="flex items-start gap-2">
                      <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-blue" />
                      {h}
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <Link href="/book-demo?step=plan" className="text-sm font-semibold">
                    Change plan
                  </Link>
                )}
                {canPay && !payment && (
                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <DemoPayButton plan={plan.key} planName={plan.name} />
                    <span className="text-xs text-muted">Already decided? Pay now and your plan starts as soon as we confirm the payment, demo or not.</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">No plan chosen yet.{canManage ? " Choose one before the demo so we can show the right things." : ""}</p>
            )}
          </GlassCard>

          <GlassCard as="section" aria-labelledby="next-steps" className="flex flex-col gap-3 p-5 sm:p-6">
            <h2 id="next-steps" className="text-base font-semibold">
              What happens next
            </h2>
            <ol className="flex flex-col gap-3 text-sm">
              <li className="flex items-start gap-3">
                <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">1</span>
                <span>
                  <strong>The demo.</strong> We look at what you sell and who you sell to, and make a first post, design and plan for your business, live.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">2</span>
                <span>
                  <strong>Your free trial.</strong> Right after the demo we open your dashboard for {settings.trialDays} {settings.trialDays === 1 ? "day" : "days"}, with everything your plan includes. No card needed.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">3</span>
                <span>
                  <strong>Keep going.</strong> Pay from the Billing page to continue. If you do nothing, your work stays saved and nothing is charged.
                </span>
              </li>
            </ol>
            <p className="flex items-start gap-2 text-xs text-muted">
              <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0" />
              Signed in as {email}. Questions before the call? Reply to your booking email.
            </p>
          </GlassCard>
        </div>
      </main>
    </div>
  );
}
