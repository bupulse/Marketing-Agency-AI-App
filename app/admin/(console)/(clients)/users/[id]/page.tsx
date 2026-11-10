import { notFound, redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { Client360, ClientStatusPill, clientHeader } from "@/components/admin/client360";
import { PageHeader } from "@/components/admin/kit";
import { Notices } from "@/components/admin/business/shared";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/service";
import { prisma } from "@/lib/db";

// A user's page is now their company's page (the same Client 360 tabs plus the Users tab). Old links keep working.
// A user with no company yet (signed up, no business) has no company page, so their Client 360 shows here directly.
export default async function UserRedirect({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("clients.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const m = await prisma.membership.findUnique({ where: { userId: id }, select: { businessId: true } });
  if (m) {
    const qs = new URLSearchParams();
    for (const k of ["tab", "notice", "error"]) if (typeof sp[k] === "string") qs.set(k, sp[k]);
    redirect(`/admin/companies/${m.businessId}${qs.size ? `?${qs}` : ""}`);
  }
  let h;
  try {
    h = await clientHeader(id);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <>
      <PageHeader icon={UserRound} tone="blue" title={<span className="break-all">{h.email}</span>} description={[h.name, "No company yet"].filter(Boolean).join(" · ")} back={{ href: "/admin/companies", label: "Companies" }} actions={<ClientStatusPill status={h.status} />} />
      <Notices sp={sp} />
      <Client360 userId={id} tab={param(sp.tab)} basePath={`/admin/users/${id}`} />
    </>
  );
}
