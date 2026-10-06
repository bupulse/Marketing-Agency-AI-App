import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";
import { getUsageSummary } from "@/lib/usage";
import { ensureAccount } from "@/lib/account";
import TestGenerate from "./TestGenerate";

// Bare-bones dashboard proving auth and the database work. The designed
// dashboard (glass sidebar etc.) is built in the UI phase.
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await ensureAccount(user);
  const [business, usage] = await Promise.all([
    prisma.business.findUnique({ where: { userId: user.id } }),
    getUsageSummary(user.id),
  ]);
  const { subscription, plan, used, limits } = usage;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className="rounded border px-3 py-1">Sign out</button>
        </form>
      </header>

      <section>
        <p>Signed in as {user.email}</p>
        <p>Business: {business?.name}</p>
        <p>
          Plan: {plan.name} ({subscription.status.toLowerCase()})
          {subscription.trialEndsAt && ` · trial ends ${subscription.trialEndsAt.toDateString()}`}
        </p>
      </section>

      <section>
        <h2 className="font-semibold">Usage this period</h2>
        <ul>
          <li>Text generations: {used.text} / {limits.text}</li>
          <li>Images: {used.image} / {limits.image}</li>
          <li>Video seconds: {used.videoSeconds} / {limits.videoSeconds}</li>
          <li>Voice characters: {used.voiceCharacters} / {limits.voiceCharacters}</li>
        </ul>
      </section>

      <TestGenerate />
    </main>
  );
}
