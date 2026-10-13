"use server";

import { redirect } from "next/navigation";
import { actionMessage, adminAction, finish, safeAdminUrl } from "@/lib/admin/console";
import { startTrial } from "@/lib/admin/demos";
import { dateTime } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/types";
import { removeInvoiceLogo, saveInvoiceSettings, uploadInvoiceLogo, LOGO_MAX_BYTES } from "@/lib/invoices/settings";
import { createActivationInvoice, markInvoicePaid, resendInvoice, sendInvoice, updateInvoiceDraft, voidInvoice } from "@/lib/invoices/service";
import { longInvoiceDate } from "@/lib/invoices/shared";

// Every action re-checks the admin first (adminAction: allow-listed email, AAL2): server actions are public POST
// endpoints. The services refuse the Jarvis API and audit every change (docs/INVOICES.md).

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const editor = (id: string) => `/admin/invoices/${encodeURIComponent(id)}`;

/** Sends the browser to `path` with ?notice= or ?error=; redirect() stays outside any try block. */
function go(path: string, kind: "notice" | "error", message: string): never {
  const url = safeAdminUrl(path);
  url.searchParams.delete("notice");
  url.searchParams.delete("error");
  url.searchParams.set(kind, message);
  redirect(url.pathname + url.search + url.hash);
}

/** The editor's state, sent as JSON in one hidden field. */
function draftOf(f: FormData): unknown {
  try {
    return JSON.parse(text(f, "data") || "null");
  } catch {
    throw new AdminError("invalid", "The invoice could not be read. Reload the page and try again.");
  }
}

/**
 * "Activate account" after the demo (Demos list and the company page): either start the trial for the number of days
 * typed (1 to 90, default the trial setting) or create a draft invoice and open it in the editor.
 */
export async function activateAccountAction(f: FormData) {
  const ctx = await adminAction("payments.approve");
  const back = text(f, "back") || "/admin/demos";
  const businessId = text(f, "businessId");
  if (text(f, "mode") === "invoice") {
    let created: { id: string; number: string; created: boolean } | null = null;
    let error: string | null = null;
    try {
      created = await createActivationInvoice(ctx, { businessId, interval: text(f, "interval") || undefined, planKey: text(f, "planKey") || undefined });
    } catch (e) {
      error = actionMessage(e);
    }
    if (!created) go(back, "error", error ?? "Something went wrong.");
    go(editor(created.id), "notice", created.created ? `Draft ${created.number} created from the client's plan. Check it, then Send.` : `${created.number} is this company's open draft. Check it, then Send.`);
  }
  await finish(back, (r) => `Trial started: ${r.days} ${r.days === 1 ? "day" : "days"}, until ${dateTime(r.trialEndsAt)}. The client has been emailed.`, () => {
    const raw = text(f, "days");
    const days = raw === "" ? undefined : Number(raw);
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 90)) throw new AdminError("invalid", "The trial is a whole number of days from 1 to 90.");
    return startTrial(ctx, { businessId, days, planKey: text(f, "planKey") || undefined });
  });
}

export async function saveInvoiceAction(f: FormData) {
  const ctx = await adminAction("payments.view");
  const id = text(f, "id");
  await finish(editor(id), (r) => `${r.number} saved. It is still a draft: the client sees it once you send it.`, () => updateInvoiceDraft(ctx, id, draftOf(f)));
}

/** Saves what the editor shows (when it carries data), then sends. */
export async function sendInvoiceAction(f: FormData) {
  const ctx = await adminAction("payments.view");
  const id = text(f, "id");
  await finish(
    editor(id),
    (r) => (r.emailed > 0 ? `${r.number} sent to ${r.to.join(", ")}.` : `${r.number} is marked sent, but the email did not go out (${r.failed} failed). Check Resend in Services, then use Resend email.`),
    async () => {
      if (f.has("data")) await updateInvoiceDraft(ctx, id, draftOf(f));
      return sendInvoice(ctx, id);
    },
  );
}

export async function resendInvoiceAction(f: FormData) {
  const ctx = await adminAction("payments.view");
  const id = text(f, "id");
  await finish(editor(id), (r) => (r.emailed > 0 ? `${r.number} emailed again to ${r.to.join(", ")}.` : "The email did not go out. Check Resend in Services."), () => resendInvoice(ctx, id));
}

export async function markInvoicePaidAction(f: FormData) {
  const ctx = await adminAction("payments.approve");
  const id = text(f, "id");
  await finish(
    editor(id),
    (r) => `${r.number} marked paid.${r.periodEnd ? ` The plan is active until ${longInvoiceDate(r.periodEnd)}${r.emailed ? " and the client has been emailed" : ""}.` : ""}`,
    () => markInvoicePaid(ctx, id, { method: text(f, "method"), reference: text(f, "reference") }),
  );
}

export async function voidInvoiceAction(f: FormData) {
  const ctx = await adminAction("payments.approve");
  const id = text(f, "id");
  await finish(editor(id), (r) => `${r.number} is void. The client can no longer pay it.`, () => voidInvoice(ctx, id, text(f, "reason"), new Date(), { acknowledgePayment: text(f, "acknowledgePayment") === "yes" }));
}

// ---- settings ------------------------------------------------------------------------------------------------

const SETTINGS_BACK = "/admin/invoices/settings";

export async function saveInvoiceSettingsAction(f: FormData) {
  const ctx = await adminAction("payments.approve");
  await finish(SETTINGS_BACK, "Invoice settings saved. New invoices and drafts use them; sent invoices keep what they were sent with.", () =>
    saveInvoiceSettings(ctx, {
      businessName: text(f, "businessName"),
      address: text(f, "address"),
      email: text(f, "email"),
      phone: text(f, "phone"),
      website: text(f, "website"),
      tin: text(f, "tin"),
      vatRatePercent: text(f, "vatRatePercent"),
      footer: text(f, "footer"),
      paymentInstructions: text(f, "paymentInstructions"),
      accentColor: text(f, "accentColor"),
    }),
  );
}

export async function uploadInvoiceLogoAction(f: FormData) {
  const ctx = await adminAction("payments.approve");
  await finish(SETTINGS_BACK, "Logo saved.", async () => {
    const file = f.get("logo");
    if (!(file instanceof Blob) || file.size === 0) throw new AdminError("invalid", "Choose a PNG or JPEG logo.");
    if (file.size > LOGO_MAX_BYTES) throw new AdminError("invalid", "The logo is at most 512 KB. Export a smaller PNG or JPEG.");
    return uploadInvoiceLogo(ctx, new Uint8Array(await file.arrayBuffer()));
  });
}

export async function removeInvoiceLogoAction() {
  const ctx = await adminAction("payments.approve");
  await finish(SETTINGS_BACK, "Logo removed.", () => removeInvoiceLogo(ctx));
}
