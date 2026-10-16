"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, GlassCard, useToast } from "@/components/ui";
import { Switch } from "@/components/autopilot/switch";
import { NetworkIcon } from "@/components/publishing/network-icon";
import { previewVoiceAction, saveContentSettingsAction } from "@/app/dashboard/content/actions";
import { VOICES } from "@/lib/voice/voices";
import { PACK_SIZE, type ContentSettings } from "@/lib/content-board/settings";
import { networkLabel } from "@/lib/content-board/labels";
import type { Network } from "@/lib/social/types";

/** "Require my approval before posting", per app. Read-only for Members. */
export function ContentSettingsForm({ initial, apps, connected, canEdit, askText }: { initial: ContentSettings; apps: readonly Network[]; connected: Network[]; canEdit: boolean; askText: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [settings, setSettings] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const changed = apps.some((a) => settings.requireApproval[a] !== initial.requireApproval[a]) || settings.packSize !== initial.packSize || settings.voiceId !== initial.voiceId;
  const [previewing, setPreviewing] = useState(false);

  async function preview() {
    setPreviewing(true);
    const res = await previewVoiceAction(settings.voiceId);
    setPreviewing(false);
    if (!res.ok) return toast(res.error, "error");
    void new Audio(res.url).play().catch(() => toast("Your browser did not play the sample.", "error"));
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveContentSettingsAction({ requireApproval: settings.requireApproval, packSize: settings.packSize, voiceId: settings.voiceId });
      if (!res.ok) return setError(res.error);
      toast("Saved. New posts follow these settings.", "success");
      router.refresh();
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="approval-heading" padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 id="approval-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Require my approval before posting
        </h2>
        <p className="text-[15px] text-muted">
          On (recommended): new posts for the app wait as &ldquo;Needs review&rdquo; until you approve them. Off: BuPulse schedules them on its own at the best time for that app. This applies to posts from Studio and from Autopilot.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {apps.map((app) => {
          const on = settings.requireApproval[app];
          return (
            <li key={app} className="flex items-center gap-3 py-3">
              <NetworkIcon network={app} size={32} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold">{networkLabel(app)}</span>
                <span className="text-[13px] text-muted">
                  {on ? "Waits for your approval" : "Scheduled on its own at the best time"}
                  {connected.includes(app) ? "" : " · not connected yet"}
                </span>
              </div>
              <Switch checked={on} disabled={!canEdit || pending} label={`Require my approval for ${networkLabel(app)}`} onChange={(v) => setSettings((s) => ({ ...s, requireApproval: { ...s.requireApproval, [app]: v } }))} />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <label htmlFor="pack-size" className="text-[15px] font-semibold">
          Posts per &ldquo;Write content&rdquo;
        </label>
        <p className="text-[14px] text-muted">Each time content is written for a product or campaign, BuPulse makes this many different posts (price, how it works, tips, a story...), each for one app. Each post uses 1 AI text.</p>
        <select
          id="pack-size"
          value={settings.packSize}
          disabled={!canEdit || pending}
          onChange={(e) => setSettings((s) => ({ ...s, packSize: Number(e.target.value) }))}
          className="min-h-12 w-32 cursor-pointer rounded-2xl border border-line bg-glass px-4 text-[15px]"
        >
          {Array.from({ length: PACK_SIZE.max - PACK_SIZE.min + 1 }, (_, i) => PACK_SIZE.min + i).map((n) => (
            <option key={n} value={n}>
              {n} posts
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <label htmlFor="voice" className="text-[15px] font-semibold">
          Voiceover voice
        </label>
        <p className="text-[14px] text-muted">The voice that speaks your videos. You can change it for one video in its panel.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select id="voice" value={settings.voiceId} disabled={!canEdit || pending} onChange={(e) => setSettings((s) => ({ ...s, voiceId: e.target.value }))} className="min-h-12 cursor-pointer rounded-2xl border border-line bg-glass px-4 text-[15px]">
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}: {v.description}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={previewing} onClick={preview}>
            {previewing ? "Loading..." : "Listen"}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-2xl bg-soft p-4 text-[14px] text-muted">
        <p>When an app needs no approval, a post still waits for you if it cannot go out safely: the account needs reconnecting, its picture is not drawn yet, or its video still has to be made (videos are made in your browser: open the post to make it).</p>
        <p>Posts scheduled on their own stay editable and can be taken back to review or deleted until they go out. You get one email a day listing them, and a notice on the Content page.</p>
        <p>Changing a setting only affects new posts.</p>
      </div>
      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
      {canEdit ? (
        <div>
          <Button onClick={save} disabled={pending || !changed}>
            {pending ? "Saving..." : "Save settings"}
          </Button>
        </div>
      ) : (
        <p className="text-[14px] text-muted">{askText}</p>
      )}
    </GlassCard>
  );
}
