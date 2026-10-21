"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { blockCreator, hideCampaign, resolveReport, unblockCreator, unhideCampaign } from "@/lib/admin/creators-marketplace";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
// `back` is checked by finish() (kept under /admin), so a forged form cannot redirect elsewhere.
const back = (f: FormData) => text(f, "back") || "/admin/creators";
const reportOf = (f: FormData) => text(f, "reportId") || undefined;

// Each action re-checks the admin first: server actions are public POST endpoints, so the layout's check is never enough.

export async function hideCampaignAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), (r: { reportResolved: boolean }) => (r.reportResolved ? "Campaign hidden from the marketplace, and the report resolved." : "Campaign hidden from the marketplace. Its link still works."), async () => {
    await hideCampaign(ctx, { campaignId: text(f, "id"), reason: text(f, "reason"), reportId: reportOf(f) });
    return { reportResolved: Boolean(reportOf(f)) };
  });
}

export async function unhideCampaignAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), "Campaign shown again. The company's own switch applies.", () => unhideCampaign(ctx, { campaignId: text(f, "id"), reason: text(f, "reason") }));
}

export async function blockCreatorAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(
    back(f),
    (r: { offersWithdrawn: number }) => `Creator blocked from the marketplace.${r.offersWithdrawn ? ` ${r.offersWithdrawn} open ${r.offersWithdrawn === 1 ? "invitation was" : "invitations were"} withdrawn.` : ""}${reportOf(f) ? " The report is resolved." : ""}`,
    () => blockCreator(ctx, { profileId: text(f, "id"), reason: text(f, "reason"), reportId: reportOf(f) }),
  );
}

export async function unblockCreatorAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), "Creator unblocked. Companies can find and invite them again.", () => unblockCreator(ctx, { profileId: text(f, "id"), reason: text(f, "reason") }));
}

export async function resolveReportAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), "Report resolved.", () => resolveReport(ctx, { reportId: text(f, "id"), note: text(f, "note") }));
}
