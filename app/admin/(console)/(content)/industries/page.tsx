import { requirePermission } from "@/lib/admin/auth";
import { INDUSTRY_FILTERS, IndustriesView } from "@/components/admin/content-ai/industries-view";
import { chosen } from "@/components/admin/kit";
import { param } from "@/lib/admin/format";
import { listDismissedSuggestions, listIndustriesAdmin, listIndustrySuggestions } from "@/lib/admin/industries-service";

export const metadata = { title: "Industries" };
export const dynamic = "force-dynamic";

export default async function IndustriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [industries, suggestions, dismissed] = await Promise.all([listIndustriesAdmin(), listIndustrySuggestions(), listDismissedSuggestions()]);
  return (
    <IndustriesView
      industries={industries}
      suggestions={suggestions}
      dismissed={dismissed}
      show={chosen(sp, "show", INDUSTRY_FILTERS, "") as "" | (typeof INDUSTRY_FILTERS)[number]}
      params={sp}
      message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }}
    />
  );
}
