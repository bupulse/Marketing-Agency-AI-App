import { requirePermission } from "@/lib/admin/auth";
import { TestimonialsView } from "@/components/admin/content-ai/testimonials-view";
import { param } from "@/lib/admin/format";
import { listTestimonialsAdmin } from "@/lib/testimonials/service";

export const metadata = { title: "Testimonials" };
export const dynamic = "force-dynamic";

export default async function TestimonialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const rows = await listTestimonialsAdmin();
  return <TestimonialsView rows={rows} message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }} />;
}
