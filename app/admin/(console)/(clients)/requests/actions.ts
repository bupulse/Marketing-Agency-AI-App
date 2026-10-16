"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { setPlanRequestStatus } from "@/lib/offers/requests";
import { REQUEST_STATUS_LABEL, isRequestStatus } from "@/lib/offers/shared";

// adminAction("requests") re-checks the admin (email, verified, AAL2). Audited in the service.
export async function setRequestStatusAction(f: FormData) {
  const ctx = await adminAction("requests");
  const id = String(f.get("id") ?? "");
  const status = String(f.get("status") ?? "");
  await finish(`/admin/requests?open=${encodeURIComponent(id)}`, `Marked ${isRequestStatus(status) ? REQUEST_STATUS_LABEL[status].toLowerCase() : status}.`, () => setPlanRequestStatus(ctx, id, status));
}
