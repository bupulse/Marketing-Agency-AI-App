// NOTE: A qualified lawyer must review these terms before launch. Bracketed items are placeholders.
import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/pages/legal";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { site } from "@/lib/content/site";
import { getSellablePlans } from "@/lib/plan-catalog";
import { getSetting } from "@/lib/admin/settings";

// Trial length (an admin setting) and plan prices (the plans an admin manages) are read live; the wording stays as written.
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Terms of Service",
  description: "The terms for using BuPulse: your account, plans and billing, AI content, connected accounts and acceptable use.",
  path: "/terms",
});

export default async function TermsPage() {
  const [trialDays, sellable] = await Promise.all([getSetting("trialDays"), getSellablePlans()]);
  return (
    <LegalPage title="Terms of Service" intro="The rules for using BuPulse, in plain English.">
      <p>
        These terms are an agreement between you and [Company legal name], [Address], United States (&quot;BuPulse&quot;, &quot;we&quot;, &quot;us&quot;). By creating an
        account or using bupulse.com or the BuPulse app (the &quot;Service&quot;), you agree to them. If you use BuPulse for a company, you confirm you can
        accept these terms for that company.
      </p>

      <LegalSection title="1. The Service">
        <p>
          BuPulse is an AI marketing assistant for small businesses. It helps you create posts, designs and scripts, publish them to the social
          networks you connect, and capture leads through a chat widget on your website. We may add, change or remove features over time.
        </p>
      </LegalSection>

      <LegalSection title="2. Your account">
        <LegalList
          items={[
            "You must be at least 18 and able to form a binding contract.",
            "Give accurate information and keep your sign-in secure. You are responsible for what happens under your account.",
            "One person or business per account unless we agree otherwise.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Demo, free trial, plans and billing">
        <LegalList
          items={[
            `New accounts start with a free demo call. After it we start a free trial of ${trialDays} days with a limited number of generations. No card is needed for the trial, and nothing is charged when it ends: if you do nothing, the account becomes read-only and your work stays saved.`,
            `Plans (${sellable.map((p) => p.name).join(", ")}) and their prices depend on the country your business is in: see our pricing page (bupulse.com/pricing) for the plans, prices, currency and payment methods for your location. Each plan has monthly usage limits shown there; on yearly plans they reset every month.`,
            "Paid plans renew at the end of each month or year until cancelled. Payments are processed by our reseller and merchant of record, Paddle.com, which appears on your card statement.",
            "You can cancel at any time. Your plan stays active until the end of the period you have paid for. Refunds follow our Refund Policy (bupulse.com/refund-policy).",
            "If a payment fails, we may limit your account until it is resolved.",
            "Done-for-you service is offered separately, from $300 per month, under a written order or invoice that describes the scope.",
            "We may change prices with at least 30 days' notice before your next renewal.",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Your content and AI output">
        <p>
          You keep ownership of the content you upload and of the output BuPulse generates for you. You give us a limited licence to host, process and
          display that content, and to send it to AI providers and the networks you choose, only as needed to run the Service for you.
        </p>
        <p>
          AI output may be inaccurate, similar to other users&apos; output, or unsuitable. You are responsible for reviewing everything before you publish
          it and for making sure it is true, legal and has the rights it needs (for example to photos, music and logos). BuPulse does not give legal,
          financial or medical advice.
        </p>
      </LegalSection>

      <LegalSection title="5. Connected accounts">
        <p>
          When you connect Instagram, Facebook, TikTok, LinkedIn, YouTube or another account, you authorise BuPulse to act for you as described in our{" "}
          <Link className="font-semibold text-[color:var(--bp-link)] underline" href="/privacy">Privacy Policy</Link>. You must follow each network&apos;s own terms and
          rules, for example Meta&apos;s, TikTok&apos;s, LinkedIn&apos;s and the{" "}
          <a className="font-semibold text-[color:var(--bp-link)] underline" href="https://www.youtube.com/t/terms" rel="noopener noreferrer" target="_blank">YouTube Terms of Service</a>
          . Networks can change or limit their APIs, and we are not responsible if a network blocks, delays or removes your posts or access. TikTok
          posts may stay private until TikTok has approved our app for public posting.
        </p>
      </LegalSection>

      <LegalSection title="6. Acceptable use">
        <p>You agree not to use BuPulse to:</p>
        <LegalList
          items={[
            "break the law or infringe anyone's rights;",
            "publish spam, scams, misleading claims, hate, harassment, sexual content involving minors, or anything else networks prohibit;",
            "impersonate others or misrepresent AI-generated content where disclosure is required;",
            "collect personal data from chat visitors without telling them or without a lawful reason;",
            "attack, probe, overload or reverse-engineer the Service, or bypass usage limits;",
            "resell the Service without our written permission.",
          ]}
        />
        <p>We may suspend or end accounts that break these rules.</p>
      </LegalSection>

      <LegalSection title="7. Chat widget and leads">
        <p>
          If you install the chat widget, you are responsible for your website&apos;s privacy notice and for handling the leads you collect lawfully. We
          process lead data on your behalf to provide the Service.
        </p>
      </LegalSection>

      <LegalSection title="8. Our property">
        <p>
          The Service, including its software, design and branding, belongs to BuPulse and its licensors. These terms give you a right to use it, not to
          own or copy it. If you send us feedback, we may use it without obligation to you.
        </p>
      </LegalSection>

      <LegalSection title="9. Ending your account">
        <p>
          You can stop using BuPulse and delete your account any time in <strong>Settings → Delete account</strong> or by emailing{" "}
          <a className="font-semibold text-[color:var(--bp-link)] underline" href={`mailto:${site.email}`}>{site.email}</a>. We delete your data as described in our Privacy
          Policy and on our <Link className="font-semibold text-[color:var(--bp-link)] underline" href="/data-deletion">data deletion page</Link>.
        </p>
      </LegalSection>

      <LegalSection title="10. Disclaimers and limits of liability">
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available&quot;. We do not promise it will be uninterrupted or error-free, or that it will produce
          any particular business result such as sales or followers. To the fullest extent the law allows, BuPulse is not liable for indirect,
          incidental or consequential damages, or lost profits or data, and our total liability for any claim is limited to the amount you paid us in the
          12 months before the claim. Some places do not allow these limits, so they may not fully apply to you.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes, law and contact">
        <p>
          We may update these terms. If a change is material, we will give notice, and continuing to use the Service means you accept it. These terms are
          governed by the laws of [State], United States, and disputes will be handled in the courts of [County, State], unless the law says otherwise.
          Questions: <a className="font-semibold text-[color:var(--bp-link)] underline" href={`mailto:${site.email}`}>{site.email}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
