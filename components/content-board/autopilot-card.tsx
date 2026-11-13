"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { GlassCard, useToast } from "@/components/ui";
import { Switch } from "@/components/autopilot/switch";
import { saveContentSettingsAction, saveDailySettingsAction } from "@/app/dashboard/content/actions";
import { approvalMode, withApprovalForAll, type ContentSettings } from "@/lib/content-board/settings";
import type { DailyPostSettings } from "@/lib/daily-posts/settings";
import type { Network } from "@/lib/social/types";

/**
 * Autopilot for posts (owner, 3 November 2026), at the top of Post settings: two switches that save at once. "Make new
 * posts every day" is the daily posts switch (null: the plan has no daily posts); "Approve and post them on their own"
 * turns approval off for every app, so each new post is scheduled at the best time and posted. The detailed cards below
 * (Daily posts made for you, Ask me to approve) stay for fine-tuning and follow these switches.
 */
export function AutopilotCard({
  daily,
  approval,
  apps,
  bestTimes,
  canEdit,
  askText,
}: {
  daily: DailyPostSettings | null;
  approval: ContentSettings;
  apps: readonly Network[];
  /** "11:30 AM and 1:30 PM": the business's first and last posting times. */
  bestTimes: string;
  canEdit: boolean;
  askText: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(daily?.enabled ?? false);
  const [auto, setAuto] = useState(approvalMode(approval, apps) === "none");
  const someApps = approvalMode(approval, apps) === "some";

  function saveCreating(on: boolean) {
    if (!daily) return;
    setCreating(on);
    start(async () => {
      const res = await saveDailySettingsAction({ ...daily, enabled: on });
      if (!res.ok) {
        setCreating(!on);
        return toast(res.error, "error");
      }
      toast(on ? "BuPulse makes new posts for you every night." : "BuPulse stops making daily posts.", "success");
      router.refresh();
    });
  }

  function saveAuto(on: boolean) {
    setAuto(on);
    start(async () => {
      const next = withApprovalForAll(approval, !on, apps);
      const res = await saveContentSettingsAction({ requireApproval: next.requireApproval, packSize: approval.packSize, voiceId: approval.voiceId });
      if (!res.ok) {
        setAuto(!on);
        return toast(res.error, "error");
      }
      toast(on ? "New posts are scheduled and posted on their own." : "New posts wait for your OK.", "success");
      router.refresh();
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="autopilot-heading" padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 id="autopilot-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Autopilot
        </h2>
        <p className="text-[15px] text-muted">Let BuPulse make your posts every day and put them out for you. You always see every new post under Posts.</p>
      </div>
      <ul className="-my-1 flex flex-col divide-y divide-line">
        <li className="flex items-start gap-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">Make new posts every day</span>
            <span className="text-[14px] text-muted">
              {daily
                ? "Every night BuPulse makes the next day’s posts for your apps, about a different product, campaign or your business each day."
                : "Your plan does not include daily posts. "}
              {!daily && (
                <Link href="/dashboard/upgrade?feature=dailyPosts" className="font-medium text-accent underline-offset-2 hover:underline">
                  See the plans
                </Link>
              )}
            </span>
          </div>
          <Switch checked={creating} disabled={!canEdit || !daily || pending} label="Make new posts every day" onChange={saveCreating} />
        </li>
        <li className="flex items-start gap-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">Approve and post them on their own</span>
            <span className="text-[14px] text-muted">
              {auto
                ? `On: each new post is scheduled at the best time, between ${bestTimes}, and posted. You can still change or cancel it until it goes out.`
                : `Off: new posts wait under “Needs your OK”. Once you approve one, BuPulse posts it at the best time, between ${bestTimes}.`}
              {someApps && " Some apps differ: see “Each app” below."}
            </span>
          </div>
          <Switch checked={auto} disabled={!canEdit || pending} label="Approve and post them on their own" onChange={saveAuto} />
        </li>
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Link href="/dashboard/content" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-accent underline-offset-2 hover:underline">
          See today’s posts <ArrowRight aria-hidden className="size-4" />
        </Link>
        {!canEdit && <p className="text-[13px] text-muted">{askText}</p>}
      </div>
    </GlassCard>
  );
}
