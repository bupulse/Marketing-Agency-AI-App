import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listFeatureFlags } from "@/lib/admin/service";
import { prisma } from "@/lib/db";
import { FlagsView } from "@/components/admin/system/flags-view";

export const metadata = { title: "Feature flags" };

export default async function FlagsPage({ searchParams }: PageProps<"/admin/flags">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const flags = await listFeatureFlags();
  const overridesOf = (f: (typeof flags)[number]) => Object.entries((f.userOverrides as Record<string, boolean> | null) ?? {});
  const ids = [...new Set(flags.flatMap((f) => overridesOf(f).map(([id]) => id)))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  const email = new Map(users.map((u) => [u.id, u.email]));
  return (
    <FlagsView
      ok={param(sp.notice)}
      bad={param(sp.error)}
      flags={flags.map((f) => ({ key: f.key, description: f.description, enabled: f.enabled, rolloutPercent: f.rolloutPercent, overrides: overridesOf(f).map(([userId, on]) => ({ userId, label: email.get(userId) ?? userId, on })) }))}
    />
  );
}
