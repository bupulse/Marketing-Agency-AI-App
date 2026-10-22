"use client";

import { Copy, ExternalLink, Pause, Play, Rocket, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setCampaignStatusAction } from "@/app/dashboard/creators/actions";
import { Button, Dialog, useToast } from "@/components/ui";

/** Copies text, saying so; the clipboard can be refused (an old phone browser), then it says how to copy by hand. */
export function useCopy() {
  const { toast } = useToast();
  return async (text: string, done = "Copied.") => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done, "success");
    } catch {
      toast("Could not copy. Press and hold the link to copy it.", "error");
    }
  };
}

/** The public application page's link, with Copy and Open. */
export function PublicLink({ slug, live }: { slug: string; live: boolean }) {
  const copy = useCopy();
  const path = `/c/${slug}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[14px]">
      <span className="text-muted">{live ? "Application page:" : "Application page (opens when live):"}</span>
      <a href={path} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-[color:var(--bp-link)] underline">
        {path}
        <ExternalLink aria-hidden className="size-3.5" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <button type="button" onClick={() => copy(`${window.location.origin}${path}`, "Link copied. Share it with creators.")} className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 font-medium text-muted hover:bg-soft hover:text-text">
        <Copy aria-hidden className="size-4" /> Copy
      </button>
    </div>
  );
}

/** Go live, pause, resume and end, each asked once more when it matters. */
export function CampaignControls({ campaignId, status, problems }: { campaignId: string; status: string; /** What a draft still needs before it can go live (empty: ready). */ problems: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);

  async function run(next: "LIVE" | "PAUSED" | "ENDED", done: string) {
    setBusy(true);
    const r = await setCampaignStatusAction(campaignId, next);
    setBusy(false);
    setEnding(false);
    if (!r.ok) return toast(r.error, "error");
    toast(done, "success");
    router.refresh();
  }

  if (status === "ENDED") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && (
        <Button size="sm" disabled={busy || problems.length > 0} title={problems[0]} leading={<Rocket aria-hidden className="size-4" />} onClick={() => run("LIVE", "Live. Creators can apply now.")}>
          Go live
        </Button>
      )}
      {status === "LIVE" && (
        <Button size="sm" variant="outline" disabled={busy} leading={<Pause aria-hidden className="size-4" />} onClick={() => run("PAUSED", "Paused. Creators cannot hand in until you resume.")}>
          Pause
        </Button>
      )}
      {status === "PAUSED" && (
        <Button size="sm" disabled={busy} leading={<Play aria-hidden className="size-4" />} onClick={() => run("LIVE", "Live again.")}>
          Resume
        </Button>
      )}
      {status !== "DRAFT" && (
        <Button size="sm" variant="outline" disabled={busy} leading={<Square aria-hidden className="size-4" />} onClick={() => setEnding(true)}>
          End campaign
        </Button>
      )}
      <Dialog open={ending} onOpenChange={setEnding} title="End this campaign?" description="Creators can no longer apply or hand in. The pay period running now still closes on its last day and pays what was earned. This cannot be undone.">
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => run("ENDED", "The campaign has ended.")}>
            End campaign
          </Button>
          <Button variant="outline" onClick={() => setEnding(false)}>
            Keep it running
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
