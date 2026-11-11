import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ensureAccount } from "@/lib/account";
import { ServicePicker, ServicesPage } from "@/components/platform/service-cards";
import { pickedServices } from "@/lib/platform/services-shared";
import { getCurrentUser } from "@/lib/supabase/server";
import { pickServices } from "./actions";

export const metadata: Metadata = { title: "What do you want to start?", robots: { index: false, follow: false } };

/** The sign-up step after the one BuPulse account is made: tick Marketing, Agency or both (docs/HOSTS.md). */
export default async function StartPage({ searchParams }: PageProps<"/apps/start">) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/apps/start");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");
  const listed = params.listed === "1" && pickedServices(user.user_metadata).includes("agency");
  // ?want=agency: the home page's "Tell me when it's ready" (BuPulse Agency, coming soon) arrives with Agency ticked.
  const wantsAgency = params.want === "agency";
  return (
    <ServicesPage email={user.email ?? null}>
      <ServicePicker action={pickServices} initial={listed || wantsAgency ? ["marketing", "agency"] : ["marketing"]} listed={listed} />
    </ServicesPage>
  );
}
