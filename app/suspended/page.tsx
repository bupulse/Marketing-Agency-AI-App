import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Account suspended",
  robots: { index: false, follow: false },
};

export default async function SuspendedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { suspendedAt: true } });
  if (!account?.suspendedAt) redirect("/dashboard");

  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Your account is suspended</h1>
        <p className="text-[15px] text-muted">
          You cannot use BuPulse right now, and nothing new will be published. Your content and settings are kept.
          Please contact BuPulse support to find out why and how to get access back.
        </p>
      </div>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </AuthShell>
  );
}
