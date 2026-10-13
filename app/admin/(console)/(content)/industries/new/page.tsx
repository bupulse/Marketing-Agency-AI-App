import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Panel } from "@/components/admin/ui";
import { EMPTY_INDUSTRY, IndustryForm } from "@/components/admin/industry-form";
import { param } from "@/lib/admin/format";
import { draftShortDescription, getIndustrySuggestion, slugify } from "@/lib/admin/industries-service";

export const metadata = { title: "New industry" };
export const dynamic = "force-dynamic";

/** Blank form, or prefilled from a sign-up suggestion (?from=<key>): name from the clients' text, a drafted description. */
export default async function NewIndustryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("content");
  const sp = await searchParams;
  const from = param(sp.from);
  const suggestion = from ? await getIndustrySuggestion(from) : null;
  const name = suggestion ? suggestion.label.charAt(0).toUpperCase() + suggestion.label.slice(1) : "";
  const initial = suggestion ? { ...EMPTY_INDUSTRY, name, slug: slugify(name), shortDescription: draftShortDescription(suggestion) } : EMPTY_INDUSTRY;
  return (
    <>
      <PageHeader title="New industry" description="Name, short description, typical customers, products and services and tone are required; the rest is recommended: it is what makes the AI's posts feel local and safe." />
      <Panel title={suggestion ? `From sign-ups: ${suggestion.label}` : "Industry"}>
        <IndustryForm initial={initial} suggestion={suggestion ? { key: suggestion.key, label: suggestion.label, count: suggestion.count } : null} />
      </Panel>
    </>
  );
}
