"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteCampaignAction, setAcceptingAction } from "@/app/dashboard/creators/actions";
import { Button, Dialog, GlassCard, useToast } from "@/components/ui";

/** Applications on or off, and deleting a draft (anything else is ended from the top of the page). */
export function CampaignSettingsExtras({ campaignId, status, accepting }: { campaignId: string; status: string; accepting: boolean }) {
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
