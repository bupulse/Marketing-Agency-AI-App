"use server";

import { redirect } from "next/navigation";
import { actionMessage, adminAction, finish, safeAdminUrl } from "@/lib/admin/console";
import { dateTime } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/types";
import { saveOfferDraft, sendOffer, withdrawOffer } from "@/lib/offers/service";

// Every action re-checks the admin first (adminAction: allow-listed email, AAL2): server actions are public POST
// endpoints. Sending an offer is the owner's own decision in the console, so it runs at once; through the Jarvis API it
// is an approval (create_offer). The services audit every change (docs/OFFERS.md).

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, kind: "notice" | "error", message: string): never {
  const url = safeAdminUrl(path);
  url.searchParams.delete("notice");
  url.searchParams.delete("error");
  url.searchParams.set(kind, message);
  redirect(url.pathname + url.search + url.hash);
}

/** The editor: save the draft, and with intent=send, send it to the company owner. */
export async function saveOfferAction(f: FormData) {
  const ctx = await adminAction();
  const businessId = text(f, "businessId");
  const offerId = text(f, "offerId") || null;
  const send = text(f, "intent") === "send";
  let id: string | null = offerId;
  let message = "";
  let error: string | null = null;
  try {
    let draft: unknown;
    try {
      draft = JSON.parse(text(f, "data") || "null");
    } catch {
      throw new AdminError("invalid", "The offer could not be read. Reload the page and try again.");
    }
    const saved = await saveOfferDraft(ctx, { businessId, offerId, draft });
    id = saved.id;
    message = "Draft saved. The client sees it once you send it.";
    if (send) {
      const sent = await sendOffer(ctx, saved.id);
      message = sent.emailed ? `Sent to ${sent.to}. Open until ${dateTime(sent.validUntil)}.` : `Marked sent (open until ${dateTime(sent.validUntil)}), but the email did not go out. The client sees it on Billing; check Resend in Services.`;
    }
  } catch (e) {
    error = actionMessage(e);
  }
  if (error) go(id ? `/admin/offers/${encodeURIComponent(id)}` : `/admin/offers/new?businessId=${encodeURIComponent(businessId)}`, "error", error);
  go(`/admin/offers/${encodeURIComponent(id as string)}`, "notice", message);
}

export async function sendOfferAction(f: FormData) {
  const ctx = await adminAction();
  const id = text(f, "id");
  await finish(`/admin/offers/${encodeURIComponent(id)}`, (r) => (r.emailed ? `Sent to ${r.to}. Open until ${dateTime(r.validUntil)}.` : `Marked sent, but the email did not go out. The client sees it on Billing.`), () => sendOffer(ctx, id));
}

export async function withdrawOfferAction(f: FormData) {
  const ctx = await adminAction();
  const id = text(f, "id");
  await finish(`/admin/offers/${encodeURIComponent(id)}`, "Withdrawn. The client no longer sees it; its open payment or invoice was closed.", () => withdrawOffer(ctx, id, text(f, "reason")));
}
