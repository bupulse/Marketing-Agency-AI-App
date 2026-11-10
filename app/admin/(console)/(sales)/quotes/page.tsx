import { QuotesView } from "@/components/admin/business/quotes-view";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { isQuoteFilter, listQuoteRequests, type QuoteFilter } from "@/lib/quote/admin";
import { setQuoteHandledAction } from "./actions";

export const metadata = { title: "Quote requests" };
export const dynamic = "force-dynamic";

export default async function QuoteRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("requests"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const filter: QuoteFilter = isQuoteFilter(param(sp.show)) ? (param(sp.show) as QuoteFilter) : "open";
  const after = param(sp.after) || null;
  const { items, next } = await listQuoteRequests({ filter, after });
  const qs = (f: QuoteFilter) => `/admin/quotes${f === "open" ? "" : `?show=${f}`}`;
  const back = `${qs(filter)}${after ? `${filter === "open" ? "?" : "&"}after=${encodeURIComponent(after)}` : ""}`;
  return <QuotesView items={items} filter={filter} next={next} back={back} sp={sp} setHandledAction={setQuoteHandledAction} />;
}
