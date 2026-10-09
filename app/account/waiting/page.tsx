import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";
import { resolveCompany } from "@/lib/team/company";

export const metadata: Metadata = {
  title: "Waiting for your company",
  robots: { index: false, follow: false },
};

// A teammate whose company has not finished its first setup: only the owner or an admin can do that.
export default async function WaitingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const company = await resolveCompany(user.id);
  const business = company ? await prisma.business.findUnique({ where: { id: company.businessId }, select: { name: true, detailsCompletedAt: true, onboardedAt: true } }) : null;
  if (!business || (business.detailsCompletedAt && business.onboardedAt)) redirect("/dashboard");
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Waiting for your company owner</h1>
        <p className="text-[15px] text-muted">
          {business.name} has not finished setting up BuPulse yet. Once the owner or an admin does, you can start working. Check back soon.
        </p>
      </div>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline" className="w-full">Sign out</Button>
      </form>
    </AuthShell>
  );
}
