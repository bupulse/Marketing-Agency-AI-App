import { isAdminSession } from "@/lib/admin/auth";
import { logError } from "@/lib/errors";
import { invoiceFileName } from "@/lib/invoices/pdf";
import { getInvoiceRow, invoicePdf } from "@/lib/invoices/service";

// "Preview PDF" in the admin console: any invoice, drafts drawn from the current settings. Signed-in AAL2 admins only;
// anyone else gets a 404 like the rest of the console.
export async function GET(request: Request, ctx: RouteContext<"/admin/invoices/[id]/pdf">) {
  if (!(await isAdminSession())) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  let row;
  try {
    row = await getInvoiceRow(id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  try {
    const pdf = await invoicePdf(row);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${invoiceFileName(row.number)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    await logError(error, { source: "invoices.admin-pdf", invoiceId: id });
    return new Response("Could not make the PDF", { status: 500 });
  }
}
