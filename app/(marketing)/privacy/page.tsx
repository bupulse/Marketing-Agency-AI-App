// NOTE: A qualified lawyer must review this policy before launch. Bracketed items are placeholders.
import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/pages/legal";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { site } from "@/lib/content/site";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description: "How BuPulse collects, uses, stores and deletes your data, including connected social accounts and AI processing.",
  path: "/privacy",
});

const mail = (
  <a className="font-semibold text-[color:var(--bp-link)] underline" href={`mailto:${site.email}`}>
    {site.email}
  </a>
);

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="We keep this simple: what we collect, why, who sees it, and how you can delete it."
    >
      <p>
        BuPulse (&quot;BuPulse&quot;, &quot;we&quot;, &quot;us&quot;) is operated by BuPulse, Kigali, Rwanda. This policy explains how
        we handle personal data when you visit bupulse.com or use the BuPulse app (together, the &quot;Service&quot;). If you have a question, email {mail}.
      </p>

      <LegalSection title="1. What we collect">
        <LegalList
          items={[
            <><strong>Account data:</strong> your name, email address and sign-in details (we use email sign-in links and Google sign-in through Supabase Auth).</>,
            <><strong>Business profile:</strong> your business name, industry, description, brand voice, logo, colours, website, and the facts you give the chat widget (hours, service area, FAQs).</>,
            <><strong>Content you create:</strong> projects, photos you upload, and the text and designs BuPulse generates for you.</>,
            <><strong>Connected accounts:</strong> if you connect Instagram, Facebook Pages, TikTok, LinkedIn or YouTube, we receive your account or Page identifier, display name, profile picture, the permissions you granted, and an access token (and refresh token where the network provides one). We also read the performance numbers of posts made through BuPulse, such as views, reach, likes, comments and shares.</>,
            <><strong>Website chat leads:</strong> if you install our chat widget, we store the conversations and any name, email, phone number or request your visitors share, on your behalf.</>,
            <><strong>Billing data:</strong> your plan and subscription status. Card details are collected and held by our payment provider, Paddle; we never see or store full card numbers.</>,
            <><strong>Messages to us:</strong> anything you send through our contact or call-booking forms.</>,
            <><strong>Visits to our website:</strong> on our public pages we count page views with our own script, without cookies. We store the page, referrer, campaign tags, device type and country, and a hash of your IP address and browser made with a random key that is deleted when the day ends (never the IP address itself), so visits on different days cannot be linked and the hash cannot be turned back into an IP address afterwards. We do not record visits when your browser sends Global Privacy Control or Do Not Track. When you sign up, the account is linked to the visit that led to it, so we can see which pages and sources bring customers.</>,
            <><strong>Technical data:</strong> basic logs such as IP address, browser type and error reports, used to keep the Service secure and working.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="2. How we use your data">
        <LegalList
          items={[
            "To provide the Service: generate content, publish and schedule posts, show results, answer your website visitors and store your leads.",
            "To run your account: sign you in, manage your plan and usage limits, send service emails and support replies.",
            "To keep the Service safe: prevent abuse, fix errors and protect against fraud.",
            "To improve BuPulse, using aggregated or de-identified information.",
          ]}
        />
        <p>We do not sell your personal data. We do not use your connected-account data for advertising, and we do not use it to train AI models.</p>
      </LegalSection>

      <LegalSection title="3. Connected social accounts and tokens">
        <p>
          When you connect a social account, you log in with that network directly and approve the permissions it shows you. We use those permissions
          only to do what you ask: publish or schedule posts you created in BuPulse, and read basic information and insights about your account and the
          posts made through BuPulse so we can show you results.
        </p>
        <LegalList
          items={[
            "Access and refresh tokens are encrypted before they are stored, and they are only decrypted on our servers at the moment we need to act for you.",
            "We never post, comment, message or follow on your behalf unless you ask us to publish something.",
            "We never share your tokens with anyone else. Pro customers who choose to use their own Composio account keep their tokens with Composio, and we store only the identifiers we need.",
            "You can disconnect any account at any time in the app. You can also remove BuPulse from the network's own settings. Either way we stop using the token and delete it.",
          ]}
        />
        <p>
          Instagram and Facebook data is received through Meta platforms and handled under Meta&apos;s Platform Terms. TikTok data is received through the
          TikTok Developer Platform and handled under TikTok&apos;s developer terms. LinkedIn data is received through LinkedIn&apos;s APIs and handled under
          LinkedIn&apos;s API terms.
        </p>
      </LegalSection>

      <LegalSection title="4. Google user data and YouTube (Limited Use)">
        <p>
          BuPulse&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
          <a className="font-semibold text-[color:var(--bp-link)] underline" href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer" target="_blank">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <LegalList
          items={[
            "If you sign in with Google, we receive your name, email address and profile picture, only to create and secure your BuPulse account.",
            "If you connect YouTube, we use the access you grant only to upload the videos you choose and to read basic channel and video information and statistics, so you can see your results in BuPulse.",
            "We use Google user data only to provide and improve these user-facing features. We do not sell it, use it for advertising, or transfer it except as needed to provide the Service, to comply with law, or as part of a merger or sale with notice to you.",
            "Our staff do not read your Google user data unless you ask us to, it is needed for security or support, or the law requires it.",
          ]}
        />
        <p>
          By using the YouTube connection you also agree to be bound by the{" "}
          <a className="font-semibold text-[color:var(--bp-link)] underline" href="https://www.youtube.com/t/terms" rel="noopener noreferrer" target="_blank">
            YouTube Terms of Service
          </a>
          , and the{" "}
          <a className="font-semibold text-[color:var(--bp-link)] underline" href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">
            Google Privacy Policy
          </a>{" "}
          applies to data you share with Google. You can revoke BuPulse&apos;s access to your Google or YouTube data at any time in your{" "}
          <a className="font-semibold text-[color:var(--bp-link)] underline" href="https://security.google.com/settings/security/permissions" rel="noopener noreferrer" target="_blank">
            Google security settings
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="5. AI processing">
        <p>
          To write text and create images, we send the information needed for the request (for example your business profile, the product you want to
          promote and your instructions) to AI providers: Google (Gemini) and Anthropic (Claude). They process it to return a result. We use their
          business interfaces, under terms that do not allow them to train their models on our customers&apos; content. Please do not put sensitive personal
          information such as health records or government ID numbers into prompts. AI output can be wrong, so review it before you publish.
        </p>
      </LegalSection>

      <LegalSection title="6. Who we share data with">
        <p>We share data only with service providers that help us run BuPulse, under agreements that limit how they use it:</p>
        <LegalList
          items={[
            "Supabase: database, sign-in and file storage (hosted in the United States).",
            "Cloudflare: hosting and network security.",
            "Paddle: payment processing and sales tax, as our reseller and merchant of record.",
            "Google and Anthropic: AI processing, as described above.",
            "The social networks you connect, when you ask us to publish or read results.",
            "Email delivery providers, to send sign-in links and service emails.",
          ]}
        />
        <p>We may also disclose data if the law requires it, or to protect the rights and safety of our users and the public.</p>
      </LegalSection>

      <LegalSection title="7. How long we keep data">
        <p>
          We keep your data while your account is open. When you delete your account, we delete your profile, business data, content, connections and
          tokens within 30 days. Backups are overwritten on their normal cycle, up to a further 35 days. We may keep limited records longer where the law
          requires, for example invoices and tax records. Records of administrative actions on your account (for example a plan change or refund) are kept
          for our own audit trail; when you delete your account their personal details are removed and only the action, date and account id remain. Product usage events (for example &ldquo;signed up&rdquo; or &ldquo;scheduled a post&rdquo;) are unlinked from you when you delete your account, and are removed after 25 months. Website page views are removed after 90 days.
        </p>
      </LegalSection>

      <LegalSection title="8. Your choices and rights">
        <p>
          You can view and edit your information in the app. You can delete your account at any time in <strong>Settings → Delete account</strong>, or email
          {" "}{mail} and we will do it for you. You can also ask us for a copy of your data or to correct it. See our{" "}
          <Link className="font-semibold text-[color:var(--bp-link)] underline" href="/data-deletion">data deletion page</Link> for the full steps. Depending on where you live
          (for example California), you may have additional rights to know, delete, correct or opt out of certain uses of your data. We will not
          discriminate against you for using them. Contact us to use any of these rights.
        </p>
      </LegalSection>

      <LegalSection title="9. Security">
        <p>
          We use encryption in transit, encrypted storage of connection tokens, access controls and database row-level security. No system is perfectly
          secure, but we work to protect your data and will tell you if a breach affects you, as the law requires.
        </p>
      </LegalSection>

      <LegalSection title="10. Cookies">
        <p>
          We use only the cookies needed to keep you signed in and to remember your light or dark theme. We do not use advertising cookies.
        </p>
      </LegalSection>

      <LegalSection title="11. Children">
        <p>BuPulse is for businesses and is not directed to children under 16. We do not knowingly collect data from children. If you think we have, email {mail} and we will delete it.</p>
      </LegalSection>

      <LegalSection title="12. International users">
        <p>
          BuPulse is operated from Rwanda and your data is stored with our hosting providers, mainly in the United States. If you use the Service from another country, you understand your data
          will be transferred to and processed in those places.
        </p>
      </LegalSection>

      <LegalSection title="13. Changes and contact">
        <p>
          If we change this policy in a meaningful way, we will update the date above and, where appropriate, notify you. Questions or requests: {mail}
          {" "}or BuPulse, Kigali, Rwanda.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
