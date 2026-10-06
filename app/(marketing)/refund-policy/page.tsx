// NOTE: A qualified lawyer must review this policy before launch.
import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/pages/legal";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { site } from "@/lib/content/site";

export const metadata = pageMetadata({
  title: "Refund Policy",
  description: "Our 14-day money-back promise on your first payment, how to cancel, and how to ask for a refund.",
  path: "/refund-policy",
});

const link = "font-semibold text-[color:var(--bp-link)] underline";

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund Policy" intro="Try BuPulse with confidence. Here is how refunds and cancellations work, in plain English.">
      <LegalSection title="1. 14-day money-back guarantee">
        <p>
          If you are not happy with BuPulse, ask for a refund within 14 days of your first payment for a plan and we will refund that payment in full.
          This applies once per account, to your first payment for Standard or Pro, monthly or yearly. Switching plans later does not start a new
          14 days; if you switch, only the extra amount charged for the switch can be refunded, within 14 days of that charge.
        </p>
      </LegalSection>

      <LegalSection title="2. Cancel any time">
        <LegalList
          items={[
            "You can cancel in the app under Billing, at any time, without contacting us.",
            "When you cancel, your plan stays active until the end of the period you have paid for, then it stops. You will not be charged again.",
            "Nothing you have made is deleted when a plan ends. Your content stays saved so you can come back.",
            "After the first 14 days, we do not refund the unused part of a period, except where the law says we must.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. How to ask for a refund">
        <p>
          Email <a className={link} href={`mailto:${site.email}`}>{site.email}</a> from the address on your account within 14 days of your first payment, and
          tell us which payment it is. We will reply within 2 business days. Approved refunds go back to the original payment method and usually appear
          within 5 to 10 business days, depending on your bank.
        </p>
      </LegalSection>

      <LegalSection title="4. Who processes your payment">
        <p>
          Our order process is conducted by our online reseller and merchant of record, Paddle.com, which handles checkout, taxes, receipts and refunds
          on our behalf. Paddle&apos;s name appears on your card statement, so the charge may not say BuPulse. Your receipt shows the exact name and has a link to their support if you
          need help with a payment.
        </p>
      </LegalSection>

      <LegalSection title="5. Failed payments">
        <p>
          If a renewal payment fails, your account is limited until you update your payment method: your content stays saved, and new content is paused.
          Update your card under Billing to carry on.
        </p>
      </LegalSection>

      <LegalSection title="6. Done-for-you service">
        <p>
          Done-for-you is offered separately under a written order or invoice, which sets out its own cancellation and refund terms.
        </p>
      </LegalSection>

      <LegalSection title="7. Questions">
        <p>
          Write to <a className={link} href={`mailto:${site.email}`}>{site.email}</a>. See also our <Link className={link} href="/terms">Terms of Service</Link>{" "}
          and <Link className={link} href="/pricing">pricing</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
