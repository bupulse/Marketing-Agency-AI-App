import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { calledUrl } from "@/lib/lead-alerts/called-link";
import { alertInBackground } from "@/lib/lead-alerts/channels";
import { scheduleLeadReminder } from "@/lib/lead-alerts/reminders";
import type { LeadAlert } from "@/lib/lead-alerts/format";
import { currentTrackedLinkId, linkTagFor } from "@/lib/links/service";
import { publicLimited } from "@/lib/request-limits";
import { QUOTE_FIELDS, QUOTE_KIND, quoteSchema, type QuoteFields, type QuoteFormState, type QuoteRequest } from "./schema";

// Stores a "Get a free quote" request (the pop-up and /quote) and alerts the owner at once (lib/lead-alerts), with the
// same protections as the contact form (lib/contact.ts): a honeypot field, a per-address limit, and the same person
// sending twice within a minute stored and alerted once. The alert goes after the response, so it never slows the form.

const DUPLICATE_WINDOW_MS = 60_000;

/** The alert for a stored request. Pure apart from the site address. */
export function quoteAlert(q: QuoteRequest, at: Date, id?: string, link?: string | null): LeadAlert {
  const site = publicSiteUrl();
  return {
    kind: "quote",
    name: q.name,
    phone: q.phone,
    email: q.email,
    company: q.businessName,
    note: q.note ?? null,
    source: q.source,
    page: q.pageUrl ? `${site}${q.pageUrl}` : null,
    link: link ?? null,
    at,
    openUrl: `${site}/admin/quotes`,
    calledUrl: id ? calledUrl(site, id) : null,
  };
}

/** Validates and stores a quote request. Returns the state the form renders. */
export async function submitQuoteRequest(formData: FormData): Promise<QuoteFormState> {
  const raw = Object.fromEntries([...QUOTE_FIELDS, "source", "pageUrl"].map((k) => [k, String(formData.get(k) ?? "")]));
  const values = Object.fromEntries(QUOTE_FIELDS.map((k) => [k, raw[k]])) as QuoteFormState["values"];

  // Honeypot: real people never see or fill this field. Pretend it worked.
  if (String(formData.get("website") ?? "").trim() !== "") return { status: "success" };

  const parsed = quoteSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: NonNullable<QuoteFormState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]) as QuoteFields;
      if ((QUOTE_FIELDS as readonly string[]).includes(key)) errors[key] ??= issue.message;
    }
    return { status: "error", errors, values };
  }

  const q = parsed.data;
  // Per client address and per email (the form is public and every request alerts the owner).
  const limited = await publicLimited("quote", q.email);
  if (limited) return { status: "error", errors: { form: limited }, values };

  try {
    const recent = await prisma.contactRequest.findFirst({
      where: { email: q.email, kind: QUOTE_KIND, createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      select: { id: true },
    });
    if (!recent) {
      // The tracked link (bupulse.com/go/<code>) this visitor came through in the last 30 days, if any.
      const trackedLinkId = await currentTrackedLinkId();
      const row = await prisma.contactRequest.create({
        data: { kind: QUOTE_KIND, name: q.name, email: q.email, phone: q.phone, businessName: q.businessName, message: q.note ?? null, source: q.source, pageUrl: q.pageUrl, trackedLinkId },
        select: { id: true, createdAt: true },
      });
      const link = await linkTagFor(trackedLinkId).catch(() => null);
      await alertInBackground(quoteAlert(q, row.createdAt, row.id, link), "quote lead alert");
      // Reminders on Telegram every 2 minutes until "✅ Called" is pressed; a failure here never fails the form.
      await scheduleLeadReminder(row.id).catch((error) => logError(error, { source: "quote.reminder", level: "warn" }));
    }
  } catch (error) {
    await logError(error, { source: "quote.submit" });
    return { status: "error", errors: { form: "Something went wrong on our side. Please try again, or email hello@bupulse.com." }, values };
  }
  return { status: "success", firstName: q.name.split(/\s+/)[0] };
}
