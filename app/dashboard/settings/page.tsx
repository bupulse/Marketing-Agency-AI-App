import { Suspense } from "react";
import { FlaskConical } from "lucide-react";
import { chosen } from "@/components/admin/kit";
import { getAppContext } from "@/components/app/context";
import { BPanel } from "@/components/app/kit/b-cards";
import { TestGenerate } from "@/components/app/test-generate";
import { CanvaCard } from "@/components/settings/canva-card";
import { SETTINGS_PARTS, SettingsView, type SettingsPart } from "@/components/settings/settings-view";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { prisma } from "@/lib/db";
import { can } from "@/lib/team/roles";
import { phoneCountryCode } from "@/lib/business-info/contacts";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/dashboard/settings">) {
  const [{ actorId, role, email, displayName, business, usage }, sp] = await Promise.all([getAppContext(), searchParams]);
  const [account, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { name: true, signUpMethod: true } }),
    prisma.membership.count({ where: { businessId: business.id } }),
  ]);
  // Back from Canva (?canva=connected) without a part: the Team & apps part, where the Canva card is.
  const part = chosen(sp, "part", SETTINGS_PARTS, typeof sp.canva === "string" ? "team" : "you") as SettingsPart;

  return (
    <>
      <Suspense>
        <CanvaReturnToast />
      </Suspense>
      <SettingsView
        part={part}
        params={sp}
        profile={{ name: account?.name ?? displayName, email, signInMethod: account?.signUpMethod === "GOOGLE" ? "Google" : "Email and password" }}
        business={
          can(role, "settings")
            ? {
                country: business.country ?? "",
                industryLabel: business.industry ?? "",
                defaults: {
                  organisationName: business.name,
                  ceoName: business.ceoName ?? "",
                  phone: formatPhone(business.phone),
                  phoneCountry: business.phone ? (phoneCountryCode(business.phone) ?? "") : "",
                  website: business.website ?? "",
                },
              }
            : null
        }
        team={{ role, canManage: can(role, "team"), members }}
        remove={{ email, wholeCompany: role === "OWNER", teammates: members - 1 }}
        canva={part === "team" ? <CanvaCard userId={actorId} next="/dashboard/settings?part=team" /> : null}
        devChecks={
          process.env.NODE_ENV !== "production" && part === "account" ? (
            <BPanel id="devchecks" icon={FlaskConical} tone="slate" title="Developer checks" hint="Only shown outside production.">
              <TestGenerate limit={usage.limits.text} resetsAt={usage.resetsAt?.toISOString() ?? null} />
            </BPanel>
          ) : null
        }
      />
    </>
  );
}
