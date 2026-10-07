import "server-only";
import { siteUrl } from "@/lib/auth/site-url";
import { renderEmail, sendEmail } from "@/lib/publishing/email";

/** "Your posts for next week are ready: approve them." Returns whether the email went out. */
export async function sendReadyEmail(args: { to: string; businessName: string; postCount: number; groupCount: number; weekLabel: string }): Promise<boolean> {
  const posts = args.postCount === 1 ? "1 post" : `${args.postCount} posts`;
  const { html, text } = renderEmail({
    heading: "Your posts for next week are ready. Approve them",
    intro: `Autopilot wrote ${posts} for ${args.businessName} for the week of ${args.weekLabel}. Have a look, change anything you like, and approve them all in one tap. Nothing is posted until you approve.`,
    button: { label: "Review and approve", url: `${siteUrl()}/dashboard/autopilot` },
    footer: "You get this email because Autopilot is switched on. You can turn it off any time on the Autopilot page.",
  });
  return sendEmail({ to: args.to, subject: "Your posts for next week are ready. Approve them", html, text });
}
