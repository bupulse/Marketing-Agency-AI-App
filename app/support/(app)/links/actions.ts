"use server";

import { revalidatePath } from "next/cache";
import { LinkError, createTrackedLink, setTrackedLinkArchived } from "@/lib/links/service";
import { requireSupportAgentPage } from "@/lib/support/app-auth";
import { canSeeVisitorAnalytics } from "@/lib/support/roles";

export type LinkActionState = { error?: string; created?: { code: string; label: string } };

/** Any support staff member makes links (theirs); admin@bupulse.com's are the company's (docs/SUPPORT_DASHBOARD.md). */
export async function createLinkAction(_prev: LinkActionState, formData: FormData): Promise<LinkActionState> {
  const me = await requireSupportAgentPage();
  if (!canSeeVisitorAnalytics(me.role)) return { error: "You cannot make links." };
  const destination = formData.get("destination") === "other" ? formData.get("customPath") : formData.get("destination");
  try {
    const link = await createTrackedLink(me, { label: formData.get("label"), channel: formData.get("channel"), destination, code: formData.get("code") });
    revalidatePath("/support/links");
    return { created: { code: link.code, label: link.label } };
  } catch (e) {
    if (e instanceof LinkError) return { error: e.message };
    throw e;
  }
}

/** Archive or bring back: the owner any link, anyone else only their own. */
export async function archiveLinkAction(formData: FormData): Promise<void> {
  const me = await requireSupportAgentPage();
  if (!canSeeVisitorAnalytics(me.role)) return;
  try {
    await setTrackedLinkArchived(me, String(formData.get("id") ?? ""), formData.get("archive") === "1");
  } catch (e) {
    if (!(e instanceof LinkError)) throw e;
  }
  revalidatePath("/support/links");
}
