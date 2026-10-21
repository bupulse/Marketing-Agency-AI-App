"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteCampaignAction, setAcceptingAction, setListedAction } from "@/app/dashboard/creators/actions";
import { Button, Dialog, GlassCard, useToast } from "@/components/ui";

/**
 * Applications on or off, "Show on the marketplace" (with BuPulse's hide when an admin hid it), and deleting a draft
 * (anything else is ended from the top of the page).
 */
export function CampaignSettingsExtras({ campaignId, status, accepting, listed, hiddenReason }: { campaignId: string; status: string; accepting: boolean; listed: boolean; /** Set when a BuPulse admin hid the campaign from the marketplace. */ hiddenReason: string | null | false }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggle() {
    setBusy(true);
    const r = await setAcceptingAction(campaignId, !accepting);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(accepting ? "Applications are closed. The page still shows the campaign." : "Applications are open.", "success");
    router.refresh();
  }
  async function toggleListed() {
    setBusy(true);
    const r = await setListedAction(campaignId, !listed);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(listed ? "Taken off the marketplace. Your link still works." : "Shown on the marketplace.", "success");
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    const r = await deleteCampaignAction(campaignId);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Draft deleted.", "success");
    router.push("/dashboard/creators");
  }

  if (status === "ENDED") return null;
  return (
    <GlassCard className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Applications</h2>
          <p className="text-[14px] text-muted">{accepting ? "Open: anyone with the link can apply while the campaign is live." : "Closed: the page shows the campaign but takes no applications."}</p>
        </div>
        <Button variant="outline" disabled={busy} onClick={toggle}>
          {accepting ? "Close applications" : "Open applications"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Marketplace</h2>
          <p className="text-[14px] text-muted">
            {listed ? "Shown on bupulse.com/creators while it is live and taking applications, so creators find it themselves." : "Not on bupulse.com/creators."} Your campaign link /c/… works either way.
          </p>
          {hiddenReason !== false && (
            <p role="status" className="mt-2 rounded-2xl bg-danger-bg px-3 py-2 text-[14px] font-medium text-danger">
              Hidden by BuPulse{hiddenReason ? `: ${hiddenReason}` : ""}. It stays off the marketplace whatever this switch says; your link still works. Questions? Contact BuPulse support.
            </p>
          )}
        </div>
        <Button variant="outline" disabled={busy} onClick={toggleListed}>
          {listed ? "Take off the marketplace" : "Show on the marketplace"}
        </Button>
      </div>
      {status === "DRAFT" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="max-w-xl text-[14px] text-muted">A draft nobody applied to can be deleted with its tasks.</p>
          <Button variant="outline" disabled={busy} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setDeleting(true)}>
            Delete draft
          </Button>
        </div>
      )}
      <Dialog open={deleting} onOpenChange={setDeleting} title="Delete this draft?" description="Its tasks go with it. This cannot be undone.">
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={remove}>Delete</Button>
          <Button variant="outline" onClick={() => setDeleting(false)}>Keep it</Button>
        </div>
      </Dialog>
    </GlassCard>
  );
}
