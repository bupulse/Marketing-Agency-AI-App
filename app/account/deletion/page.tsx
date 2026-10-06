import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";
import { keepAccount } from "./actions";

export const metadata: Metadata = {
  title: "Account scheduled for deletion",
  robots: { index: false, follow: false },
};

export default async function AccountDeletionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true } });
  if (!account?.deletionScheduledFor) redirect("/dashboard");

  const date = account.deletionScheduledFor.toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" });

  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Your account will be deleted on {date}</h1>
        <p className="text-[15px] text-muted">
          Your account is locked. On that date your account, business, brand, content, files, connections and leads
          are erased for good. Change your mind and everything is exactly as you left it.
        </p>
      </div>
      <form action={keepAccount}>
        <Button type="submit" className="w-full">
          Keep my account
        </Button>
      </form>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </AuthShell>
  );
}
