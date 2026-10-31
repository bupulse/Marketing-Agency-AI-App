"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { setQuoteHandled } from "@/lib/quote/admin";

// adminAction("requests") re-checks the admin (email, verified, AAL2). Audited in the service.
export async function setQuoteHandledAction(f: FormData) {
  const ctx = await adminAction("requests");
  const id = String(f.get("id") ?? "");
  const handled = f.get("handled") === "1";
  const back = String(f.get("back") ?? "/admin/quotes");
  await finish(back, (r) => (handled ? `${r.name} marked called.` : `${r.name} is back on the list to call.`), () => setQuoteHandled(ctx, id, handled));
}
