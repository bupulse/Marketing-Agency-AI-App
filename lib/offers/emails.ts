import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { formatMinor } from "@/lib/region-format";
import { linkSiteUrl } from "@/lib/auth/request-site";

// Emails of the custom plan flow (docs/OFFERS.md). All go through sendEmail (Resend, kill switch respected) and return
// whether the mail went out; nothing here throws. The "plan is active" email after payment is the Mobile Money one.

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kigali" });
const first = (name: string | null | undefined) => (name ? `Hi ${name.split(/\s+/)[0]}, ` : "");
const per = (interval: string) => (interval === "YEAR" ? "a year" : "a month");

/** Features added to the running plan (lib/offers/shared.ts OfferAddition): one prorated payment, not a price per month. */
type AdditionNote = { daysLeft: number; nextRenewalMinor: number } | null | undefined;
const paidOnce = (totalMinor: number, currency: string, a: NonNullable<AdditionNote>) => `${formatMinor(totalMinor, currency)}, paid once for the ${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"} left of your period`;

/** The company owner's email when an offer is sent: what is in it, the price, until when, and the Billing link. */
export async function sendOfferEmail(to: { email: string; name: string | null }, p: { company: string; totalMinor: number; currency: string; interval: string; features: string[]; validUntil: Date; note: string | null; addition?: AdditionNote }): Promise<boolean> {
  const url = `${(await linkSiteUrl())}/dashboard/billing#offer`;
  if (p.addition) {
    const price = paidOnce(p.totalMinor, p.currency, p.addition);
    const added = renderEmail({
      heading: "Features for your BuPulse plan are ready",
      intro: `${first(to.name)}we have priced what you asked to add to ${p.company}'s plan: ${price}. From your next renewal your plan costs ${formatMinor(p.addition.nextRenewalMinor, p.currency)} ${per(p.interval)}. Open Billing to accept and pay. The offer is open until ${longDate(p.validUntil)}.`,
      blocks: [
        { label: "To pay now", value: price },
        { label: "Adds", value: p.features.join(", ") || "See Billing" },
        ...(p.note ? [{ label: "From the BuPulse team", value: p.note }] : []),
      ],
      button: { label: "See the offer", url },
      footer: "Nothing changes until you accept and pay. Your plan's renewal date stays the same.",
    });
    return sendEmail({ to: to.email, subject: `Features for your BuPulse plan: ${formatMinor(p.totalMinor, p.currency)}, paid once`, html: added.html, text: added.text });
  }
  const { html, text } = renderEmail({
    heading: "Your custom BuPulse plan is ready",
    intro: `${first(to.name)}we have put together a plan for ${p.company}: ${formatMinor(p.totalMinor, p.currency)} ${per(p.interval)}. Open Billing to see what is in it, accept it and pay. The offer is open until ${longDate(p.validUntil)}.`,
    blocks: [
      { label: "Price", value: `${formatMinor(p.totalMinor, p.currency)} ${per(p.interval)}` },
      { label: "Includes", value: p.features.join(", ") || "See Billing" },
      ...(p.note ? [{ label: "From the BuPulse team", value: p.note }] : []),
    ],
    button: { label: "See your offer", url },
    footer: "Nothing changes until you accept and pay. Your current plan and everything you have made stay as they are.",
  });
  return sendEmail({ to: to.email, subject: `Your custom BuPulse plan: ${formatMinor(p.totalMinor, p.currency)} ${per(p.interval)}`, html, text });
}

/** The owner's alert for a new custom plan request. One email per address in ADMIN_EMAILS. */
export async function sendRequestAlertEmail(p: { id: string; company: string; email: string; phone: string | null; description: string; goals?: string | null; features: string[]; budget: string | null; demo: string | null }): Promise<boolean> {
  const admins = adminEmails();
  if (admins.length === 0) return false;
  const { html, text } = renderEmail({
    heading: "New custom plan request",
    intro: `${p.company} (${p.email}) asked for a custom plan.`,
    blocks: [
      { label: "The business", value: p.description },
      ...(p.goals ? [{ label: "Goals", value: p.goals }] : []),
      { label: "Interested in", value: p.features.join(", ") || "Not said" },
      ...(p.budget ? [{ label: "Budget", value: p.budget }] : []),
      ...(p.phone ? [{ label: "Phone", value: p.phone }] : []),
      ...(p.demo ? [{ label: "Demo", value: p.demo }] : []),
    ],
    button: { label: "Open the request", url: `${(await linkSiteUrl())}/admin/requests?open=${encodeURIComponent(p.id)}` },
  });
  const results = await Promise.all(admins.map((to) => sendEmail({ to, subject: `Custom plan request: ${p.company}`, html, text })));
  return results.some(Boolean);
}

/** The client's reminder that an accepted offer is not paid yet (day 3 and day 7 after accepting). */
export async function sendOfferReminderEmail(to: { email: string; name: string | null }, p: { day: 3 | 7; totalMinor: number; currency: string; interval: string; method: string | null; addition?: AdditionNote }): Promise<boolean> {
  const url = `${(await linkSiteUrl())}/dashboard/billing#offer`;
  const how = p.method === "invoice" ? "Pay the invoice by Mobile Money with its number, or as it says." : "Pay by Mobile Money from Billing and tap I've paid.";
  if (p.addition) {
    const added = renderEmail({
      heading: "Your added features are waiting for payment",
      intro: `${first(to.name)}you accepted the features added to your BuPulse plan (${paidOnce(p.totalMinor, p.currency, p.addition)}) ${p.day} days ago. They switch on as soon as your payment is confirmed. ${how}`,
      button: { label: "Pay now", url },
      footer: "Changed your mind? Reply to this email. Your plan stays as it is until you pay.",
    });
    return sendEmail({ to: to.email, subject: "Your added BuPulse features are waiting for payment", html: added.html, text: added.text });
  }
  const { html, text } = renderEmail({
    heading: p.day === 7 ? "Your custom plan is still waiting" : "Your custom plan is waiting for payment",
    intro: `${first(to.name)}you accepted your custom BuPulse plan (${formatMinor(p.totalMinor, p.currency)} ${per(p.interval)}) ${p.day} days ago. It switches on as soon as your payment is confirmed. ${how}`,
    button: { label: "Pay now", url },
    footer: "Changed your mind, or need something different? Reply to this email. Your current plan stays as it is until you pay.",
  });
  return sendEmail({ to: to.email, subject: p.day === 7 ? "Reminder: your custom BuPulse plan is not paid yet" : "Your custom BuPulse plan is waiting for payment", html, text });
}
