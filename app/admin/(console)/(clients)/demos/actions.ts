"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { retryDemoCalendar, setDemoStatus, startTrial } from "@/lib/admin/demos";
import { dateTime } from "@/lib/admin/format";
import { dismissRegionMismatch, setCompanyRegion } from "@/lib/admin/regions-service";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData) => text(f, "back") || "/admin/demos";

// Every action re-checks the admin (adminAction: allow-listed email, AAL2) first: server actions are public POST
// endpoints, so the layout's check is never enough. The confirm dialog is the confirmation; everything is audited.

export async function demoStatusAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), (r) => (r.status === "done" ? "Demo marked done." : r.status === "no_show" ? "Demo marked as a no-show." : "Demo cancelled."), () =>
    setDemoStatus(ctx, { id: text(f, "id"), status: text(f, "status"), notes: f.has("notes") ? text(f, "notes") : undefined }),
  );
}

export async function startTrialAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), (r) => `Trial started: ${r.days} ${r.days === 1 ? "day" : "days"}, until ${dateTime(r.trialEndsAt)}. The client has been emailed.`, () =>
    startTrial(ctx, { businessId: text(f, "businessId"), planKey: text(f, "planKey") || undefined }),
  );
}

export async function companyRegionAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), (r) => (r.changed ? `Region changed to ${r.pricingRegion}. Billing now shows that region's plans and prices.` : "The company is already in that region."), () =>
    setCompanyRegion(ctx, { businessId: text(f, "businessId"), regionKey: text(f, "regionKey") }),
  );
}

export async function dismissRegionMismatchAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), (r) => (r.changed ? "Region check dismissed. The company keeps its region." : "There was nothing to dismiss."), () =>
    dismissRegionMismatch(ctx, { businessId: text(f, "businessId") }),
  );
}

export async function retryDemoCalendarAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), (r) => (r.already ? "That demo's calendar event was already up to date." : "Google Calendar updated."), () => retryDemoCalendar(ctx, text(f, "id")));
}
