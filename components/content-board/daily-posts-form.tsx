"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, GlassCard, useToast } from "@/components/ui";
import { Switch } from "@/components/autopilot/switch";
import { NetworkIcon } from "@/components/publishing/network-icon";
import { saveDailySettingsAction } from "@/app/dashboard/content/actions";
import { networkLabel } from "@/lib/content-board/labels";
import { appsText, dailyApps, type DailyPostSettings } from "@/lib/daily-posts/settings";
import type { Network } from "@/lib/social/types";
import { VideoQualityPicker } from "@/components/visuals/video-quality-picker";
import type { VideoQualityOffer } from "@/lib/visuals/video-quality-server";

/** "Daily posts made for you": on/off, posts per app, which apps and the design style. Read-only for Members. */
export function DailyPostsForm({
  initial,
  apps,
  connected,
  perAppLimit,
  appsLimit = null,
  videoOffer = null,
  aiPhotos,
  canEdit,
  askText,
}: {
  initial: DailyPostSettings;
  apps: readonly Network[];
  connected: Network[];
  perAppLimit: number;
  /** The plan's apps a day (Starter: 1); null: every app. */
  appsLimit?: number | null;
  /** The "Videos" choice; null when the plan makes no videos. */
  videoOffer?: VideoQualityOffer | null;
  aiPhotos: boolean;
  canEdit: boolean;
  askText: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [settings, setSettings] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const chosen = dailyApps(settings, connected, appsLimit);
  const changed = JSON.stringify(settings) !== JSON.stringify(initial);
  const locked = !canEdit || pending;

  function toggleApp(app: Network, on: boolean) {
    // With one app a day, turning another app on moves the daily post there.
    if (on && appsLimit === 1) return setSettings((s) => ({ ...s, apps: [app] }));
    if (on && appsLimit && chosen.length >= appsLimit) return toast(`Your plan makes daily posts for ${appsText(appsLimit)} a day. Turn one off first.`, "error");
    const next = on ? [...new Set([...chosen, app])] : chosen.filter((a) => a !== app);
    if (next.length === 0) return toast("Keep at least one app, or switch daily posts off.", "error");
    setSettings((s) => ({ ...s, apps: apps.filter((a) => next.includes(a)) }));
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveDailySettingsAction(settings);
      if (!res.ok) return setError(res.error);
      toast("Saved. Tomorrow's posts follow these settings.", "success");
      router.refresh();
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="daily-heading" padding="lg" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 id="daily-heading" className="text-xl font-semibold tracking-[-0.02em]">
            Daily posts made for you
          </h2>
          <p className="text-[15px] text-muted">
            Every night BuPulse makes the day&rsquo;s posts for you, about a different product, campaign or your business each day. You find them in the morning under Posts, &ldquo;Today: needs review&rdquo; (or already scheduled for apps that need no approval). They use your plan&rsquo;s AI texts, spread over the month so they never use it all up.
          </p>
        </div>
        <Switch checked={settings.enabled} disabled={locked} label="Daily posts made for you" onChange={(v) => setSettings((s) => ({ ...s, enabled: v }))} />
      </div>

      {settings.enabled && (
        <>
          <div className="flex flex-col gap-2 border-t border-line pt-5">
            <label htmlFor="daily-per-app" className="text-[15px] font-semibold">
              Posts per app each day
            </label>
            <select
              id="daily-per-app"
              value={settings.perApp}
              disabled={locked}
              onChange={(e) => setSettings((s) => ({ ...s, perApp: Number(e.target.value) }))}
              className="min-h-12 w-32 cursor-pointer rounded-2xl border border-line bg-glass px-4 text-[15px]"
            >
              {Array.from({ length: perAppLimit }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "post" : "posts"}
                </option>
              ))}
            </select>
            <p className="text-[13px] text-muted">Your plan allows up to {perAppLimit} per app a day. Posts you or Autopilot already planned for the day count.</p>
          </div>

          <fieldset className="flex flex-col gap-2 border-t border-line pt-5">
            <legend className="text-[15px] font-semibold">Apps</legend>
            <p className="text-[13px] text-muted">
              {appsLimit ? `Your plan makes daily posts for ${appsText(appsLimit)} a day${appsLimit === 1 ? ": pick the one you use most" : ""}. ` : ""}
              {settings.apps ? "The apps you chose." : "Your connected apps (Instagram and Facebook while none is connected)."} Apps that are not connected get a reminder to post it yourself.
            </p>
            <ul className="flex flex-col divide-y divide-line">
              {apps.map((app) => (
                <li key={app} className="flex items-center gap-3 py-2.5">
                  <NetworkIcon network={app} size={28} />
                  <span className="min-w-0 flex-1 text-[15px]">
                    {networkLabel(app)}
                    {connected.includes(app) ? "" : <span className="text-[13px] text-muted"> · not connected yet</span>}
                  </span>
                  <Switch checked={chosen.includes(app)} disabled={locked} label={`Daily posts for ${networkLabel(app)}`} onChange={(v) => toggleApp(app, v)} />
                </li>
              ))}
            </ul>
            {settings.apps && (
              <button type="button" disabled={locked} onClick={() => setSettings((s) => ({ ...s, apps: null }))} className="min-h-11 w-fit text-[14px] font-medium text-muted underline underline-offset-4 hover:text-text">
                Use my connected apps
              </button>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2 border-t border-line pt-5">
            <legend className="text-[15px] font-semibold">Design style</legend>
            {(
              [
                ["free", "Your own photos", "Your product photos as they are, no credits used."],
                ["ai", "Unique AI pictures", aiPhotos ? "A different finished ad every day while your AI image credits last, spread over the month; then your own photos." : "Not available on your plan right now: your own photos are used."],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-[15px]">
                <input type="radio" name="daily-design" className="mt-1 size-5" checked={settings.design === value} disabled={locked || (value === "ai" && !aiPhotos)} onChange={() => setSettings((s) => ({ ...s, design: value }))} />
                <span className="flex flex-col">
                  <span className="font-medium">{label}</span>
                  <span className="text-[13px] text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {videoOffer && (
            <div className="border-t border-line pt-5">
              <VideoQualityPicker name="daily-video-quality" value={settings.videoQuality} onChange={(v) => setSettings((s) => ({ ...s, videoQuality: v }))} offer={videoOffer} disabled={locked} />
            </div>
          )}
        </>
      )}

      <p className="rounded-2xl bg-soft p-4 text-[14px] text-muted">Changes apply from tomorrow&rsquo;s posts. Contest ideas always wait for you to confirm the prize and rules.</p>
      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
      {canEdit ? (
        <div>
          <Button onClick={save} disabled={pending || !changed}>
            {pending ? "Saving..." : "Save daily posts"}
          </Button>
        </div>
      ) : (
        <p className="text-[14px] text-muted">{askText}</p>
      )}
    </GlassCard>
  );
}
