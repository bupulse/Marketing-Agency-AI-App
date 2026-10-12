import { checkActiveUser } from "@/lib/auth/require-user";
import { logError } from "@/lib/errors";
import { invoiceFileName } from "@/lib/invoices/pdf";
import { clientInvoiceRow, invoicePdf } from "@/lib/invoices/service";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { can } from "@/lib/team/roles";

// The client's invoice PDF (docs/INVOICES.md). Only the company's Owner (the `billing` permission) and only an invoice
// of their own company that has been sent: anything else answers 404, so ids of other companies' invoices reveal nothing.
export async function GET(_request: Request, ctx: RouteContext<"/api/invoices/[id]/pdf">) {
  const check = await checkActiveUser();
  if (check.status === "signed_out") return new Response("Unauthorized", { status: 401 });
  if (check.status !== "ok") return new Response("Forbidden", { status: 403 });
  const user = check.user;
  if (!can(user.role, "billing")) return new Response("Ask your company owner for this invoice.", { status: 403 });
  const { id } = await ctx.params;
  const row = await clientInvoiceRow(user.businessId, decodeURIComponent(id));
  if (!row) return new Response("Not found", { status: 404 });
  try {
    await rateLimit(`invoice-pdf:${user.id}`, RATE_LIMITS.invoicePdf);
    const pdf = await invoicePdf(row);
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceFileName(row.number)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof RateLimitError) return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    await logError(error, { source: "invoices.client-pdf", userId: user.id });
    return new Response("Could not make the PDF", { status: 500 });
  }
}
