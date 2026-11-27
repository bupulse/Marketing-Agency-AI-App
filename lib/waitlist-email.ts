import "server-only";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import type { WaitlistInfo } from "./waitlist";

// The thank-you every waiting-list sign-up gets at once (owner's decision of 27 Nov 2026: English only, from the usual
// BuPulse sender, replies to hello@). Sent after the response (lib/quote/submit.ts), never slowing the form.

export const WAITLIST_REPLY_TO = "hello@bupulse.com";

/** The email for one person. Pure apart from the site address. */
export function waitlistThankYou(firstName: string | null, info: WaitlistInfo): { subject: string; html: string; text: string } {
  const { html, text } = renderEmail({
    heading: "You're on the list 🎄",
    intro: `${firstName ? `Hi ${firstName}, thank you` : "Thank you"} for joining the BuPulse waiting list. Our team is reviewing your application, and we launch on ${info.dateLabel}.`,
    blocks: [
      { label: "What happens next", value: `Before ${info.dateLabel}, someone from our team will call you to get to know your business and what you need, so everything is ready for you on launch day.` },
      { label: "What you get", value: "Your own AI marketing team that you control: posts designed and written for your business, videos and an AI influencer, published on time on Instagram, Facebook and more. You approve, BuPulse does the rest." },
    ],
    button: { label: "Visit bupulse.com", url: publicSiteUrl() },
    footer: "This Christmas ends with your own AI marketing team. Questions? Just reply to this email. The BuPulse team, Kigali.",
  });
  return { subject: `You're on the list: BuPulse launches ${info.dateLabel}`, html, text };
}

/** Sends the thank-you. Returns false (never throws) when it could not be sent; the request itself is already saved. */
export async function sendWaitlistThankYou(to: string, firstName: string | null, info: WaitlistInfo): Promise<boolean> {
  const email = waitlistThankYou(firstName, info);
  return sendEmail({ to, ...email, replyTo: WAITLIST_REPLY_TO });
}
