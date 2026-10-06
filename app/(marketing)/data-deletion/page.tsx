// NOTE: A qualified lawyer must review this page before launch. Bracketed items are placeholders.
import { CircleCheck } from "lucide-react";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/pages/legal";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { GlassCard } from "@/components/ui";
import { prisma } from "@/lib/db";
import { site } from "@/lib/content/site";

export const metadata = pageMetadata({
  title: "Data deletion",
  description: "How to delete your BuPulse account and data, including data received from Instagram, Facebook, TikTok, LinkedIn and Google.",
  path: "/data-deletion",
});

const CODE = /^[A-Za-z0-9_-]{6,64}$/;

async function requestExists(code: string) {
  try {
    const row = await prisma.contactRequest.findFirst({
      where: { kind: "meta_data_deletion", message: { contains: `code=${code}` } },
      select: { createdAt: true, handled: true },
    });
    return row ?? null;
  } catch {
    return null;
  }
}

export default async function DataDeletionPage({ searchParams }: PageProps<"/data-deletion">) {
  const raw = (await searchParams).code;
  const code = typeof raw === "string" && CODE.test(raw) ? raw : undefined;
  const found = code ? await requestExists(code) : null;
  const mail = (
    <a className="font-semibold text-[color:var(--bp-link)] underline" href={`mailto:${site.email}`}>
      {site.email}
    </a>
  );

  return (
    <LegalPage title="Data deletion" intro="How to delete your BuPulse account and the data we hold about you.">
      {code && (
        <GlassCard strong padding="md" role="status" className="flex gap-3">
          <CircleCheck aria-hidden className="mt-1 size-6 shrink-0 text-success" />
          <div>
            <p className="font-semibold">Deletion request {found ? (found.handled ? "completed" : "received") : "status"}</p>
            <p className="text-muted">
              {found
                ? found.handled
                  ? `Request ${code} has been completed. The data we received from Meta for this request has been deleted.`
                  : `We received request ${code} on ${found.createdAt.toISOString().slice(0, 10)}. We will delete the data we received from Meta for this request within 30 days.`
                : `We could not find request ${code}. If you believe this is a mistake, email ${site.email} and include this code.`}
            </p>
          </div>
        </GlassCard>
      )}

      <LegalSection title="Delete your account yourself">
        <ol className="flex list-decimal flex-col gap-2 pl-6 marker:font-semibold marker:text-pulse-blue">
          <li>Sign in to BuPulse.</li>
          <li>Open <strong>Settings</strong>.</li>
          <li>Choose <strong>Delete account</strong> and confirm.</li>
        </ol>
        <p>
          Your profile, business information, content, leads, connected accounts and stored tokens are deleted within 30 days. Backups are overwritten
          within a further 35 days. We may keep limited billing records where the law requires.
        </p>
      </LegalSection>

      <LegalSection title="Ask us to delete it">
        <p>
          Email {mail} from the address you signed up with and write &quot;Delete my data&quot;. We will confirm by email and complete the deletion within 30 days.
          If you can no longer sign in, tell us the email you used and we will verify it with you.
        </p>
      </LegalSection>

      <LegalSection title="Remove only a connected social account">
        <LegalList
          items={[
            "In BuPulse, open Connections and choose Disconnect next to the account. We delete the stored tokens straight away.",
            "Or remove BuPulse in the network's own settings: Facebook and Instagram under Settings → Business integrations, TikTok under Settings → Security → Manage app permissions, LinkedIn under Settings → Data privacy → Permitted services, and Google or YouTube in your Google Account security settings.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Data received from Meta (Facebook and Instagram)">
        <p>
          If you remove BuPulse from your Facebook or Instagram settings and ask Facebook to delete your data, Meta sends us a deletion request
          automatically. We delete the Meta data and tokens linked to your account and give you a confirmation code. You can check its status on this page
          using the link Meta shows you, or email {mail} with your code.
        </p>
      </LegalSection>

      <LegalSection title="Questions">
        <p>Email {mail} or write to [Company legal name], [Address].</p>
      </LegalSection>
    </LegalPage>
  );
}
