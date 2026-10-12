import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// The private "invoices" Storage bucket (migration 20261013090000_invoices): invoice PDFs and the invoice logo. No
// Storage policy names it, so only the service key reaches it; every caller has already checked who is asking
// (an AAL2 admin, or the client whose company the invoice belongs to).

export const INVOICE_BUCKET = "invoices";

export const invoicePdfPath = (businessId: string, number: string) => `pdf/${businessId}/${number}.pdf`;

export async function putInvoiceObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await createAdminClient().storage.from(INVOICE_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

/** The file's bytes, or null when it is missing or Storage cannot be reached (callers fall back to drawing it again). */
export async function getInvoiceObject(path: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await createAdminClient().storage.from(INVOICE_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

export async function removeInvoiceObject(path: string): Promise<void> {
  try {
    await createAdminClient().storage.from(INVOICE_BUCKET).remove([path]);
  } catch {
    // An orphaned logo costs nothing; never fail a save over it.
  }
}
