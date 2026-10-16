"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { reassign } from "@/lib/sales/assign";

// adminAction("clients.reassign") re-checks the person and the permission: server actions are public POST endpoints.
// The change and its audit row are one transaction (lib/sales/assign.ts).

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function reassignClientAction(f: FormData) {
  const ctx = await adminAction("clients.reassign");
  await finish("/admin/sales/team", "Client reassigned. Payments from now on count for the new agent.", () =>
    reassign(ctx, { businessId: text(f, "businessId"), staffId: text(f, "staffId") || null, reason: text(f, "reason") }),
  );
}
