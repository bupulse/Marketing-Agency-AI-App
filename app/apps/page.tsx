import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ensureAccount } from "@/lib/account";
import { safeNext } from "@/lib/auth/safe-next";
import { ServiceChooser, ServicesPage } from "@/components/platform/service-cards";
import { prisma } from "@/lib/db";
import { greetingFirstName } from "@/lib/platform/first-name";
import { clientServices } from "@/lib/platform/services";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your services", robots: { index: false, follow: false } };

/**
 * "Where to?" after the one client sign-in on bupulse.com (docs/HOSTS.md): a card per service the person has. With
 * exactly one they go straight there (unless they came from "All services", ?all=1); a new account picks what to
 * start first (/apps/start); a safe ?next= (our client hosts only, lib/auth/safe-next.ts) goes straight there.
 */
export default async function AppsPage({ searchParams }: PageProps<"/apps">) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/apps");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");

  const next = typeof params.next === "string" ? safeNext(params.next, "") : "";
  if (next && next !== "/apps" && !next.startsWith("/apps?")) redirect(next);

  const services = await clientServices(user);
  if (services.needsPick) redirect("/apps/start");
  if (params.all !== "1" && services.cards.length === 1 && services.waiting.length === 0) redirect(services.cards[0].href!);

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }).catch(() => null);
  const firstName = greetingFirstName(account?.name, user.user_metadata as { full_name?: string; name?: string; ceo_name?: string } | undefined);
  return (
    <ServicesPage email={user.email ?? null}>
      <ServiceChooser firstName={firstName} cards={services.cards} waiting={services.waiting} addHref={services.waiting.some((w) => w.id === "agency") ? null : "/apps/start"} />
    </ServicesPage>
  );
}
