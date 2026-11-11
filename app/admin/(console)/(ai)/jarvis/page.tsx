import { requirePermission } from "@/lib/admin/auth";
import { JarvisView } from "@/components/admin/content-ai/jarvis-view";
import { param } from "@/lib/admin/format";
import { listAdminKeys } from "@/lib/admin/keys";
import { frontLinkUrl } from "@/lib/auth/request-site";

export const metadata = { title: "Jarvis" };

export default async function JarvisPage({ searchParams }: PageProps<"/admin/jarvis">) {
  await requirePermission("jarvis"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const keys = await listAdminKeys();
  const base = await frontLinkUrl();
  return <JarvisView keys={keys} base={base} message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }} />;
}
