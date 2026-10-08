import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { WelcomeForm } from "@/components/auth/welcome-form";
import { prisma } from "@/lib/db";
import { ensureAccount } from "@/lib/account";
import { getCurrentUser } from "@/lib/supabase/server";
import { readReturn } from "@/lib/auth/return-server";

export const metadata: Metadata = {
  title: "About your organisation",
  robots: { index: false, follow: false },
};

// Google sign-ups land here before their first visit to the dashboard.
export default async function WelcomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/welcome");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");

  const [business, account] = await Promise.all([
    prisma.business.findUnique({ where: { userId: user.id } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true } }),
  ]);
  if (account?.suspendedAt) redirect("/suspended");
  if (account?.deletionScheduledFor) redirect("/account/deletion");
  if (business?.detailsCompletedAt) redirect(await readReturn());

  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;

  return (
    <AuthShell wide>
      <WelcomeForm
        email={user.email ?? ""}
        defaults={{
          organisationName: business && business.name !== "My business" ? business.name : "",
          ceoName: business?.ceoName ?? meta?.full_name ?? meta?.name ?? "",
          industry: business?.industry ?? "",
          country: business?.country ?? "",
          phone: business?.phone ?? "",
          website: business?.website ?? "",
        }}
      />
    </AuthShell>
  );
}
