"use client";

import { Check, ChevronDown, Plus, SlidersHorizontal, X } from "lucide-react";
import { useState, useTransition } from "react";
import { saveAutopilotSettings } from "@/app/dashboard/autopilot/actions";
import { AccountAvatar } from "@/components/publishing/network-icon";
import { Badge, Button, GlassCard, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AutopilotConfig } from "@/lib/autopilot/settings";
import { defaultAccountIds, MAX_POSTING_TIMES, MAX_POSTS_PER_WEEK, MIN_POSTS_PER_WEEK } from "@/lib/autopilot/settings";
import type { ViewAccount } from "@/lib/autopilot/view";
import { VideoQualityPicker } from "@/components/visuals/video-quality-picker";
import type { VideoQualityOffer } from "@/lib/visuals/video-quality-server";
import { ChoiceChips } from "@/components/app/kit/a-choice-cards";
import { Switch } from "./switch";

/** Posts-a-week choices shown as chips (any saved number in the range is kept and shown too). */
const WEEK_CHOICES = [2, 3, 5, 7, 10, 14].filter((n) => n >= MIN_POSTS_PER_WEEK && n <= MAX_POSTS_PER_WEEK);
/** Common posting times, added in one tap (lunch time, 11:30 to 13:30, is the best default). */
const TIME_IDEAS = ["08:00", "12:30", "13:00", "18:00", "20:00"];

function ToggleRow({ title, text, checked, onChange }: { title: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">{title}</p>
        <p className="text-[14px] text-muted">{text}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

/** Autopilot's settings: on/off, accounts, how many posts, times and the three "how" choices. */
export function SettingsCard({ initial, accounts, timeZone, videoOffer = null }: { initial: AutopilotConfig; accounts: ViewAccount[]; timeZone: string; videoOffer?: VideoQualityOffer | null }) {
  const [config, setConfig] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [newTime, setNewTime] = useState("12:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const set = <K extends keyof AutopilotConfig>(key: K, value: AutopilotConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));

  function save(next: AutopilotConfig, message: string) {
    setError(null);
    start(async () => {
      const result = await saveAutopilotSettings(next);
      if (result.ok) {
        setSaved(next);
        toast(message, "success");
      } else {
        setError(result.error);
        // Said where the switch is too: the message under the form may be out of sight.
        toast(result.error, "error");
        if (next.enabled !== saved.enabled) setConfig((c) => ({ ...c, enabled: saved.enabled }));
      }
    });
  }

  function toggleAccount(id: string) {
    set("connectionIds", config.connectionIds.includes(id) ? config.connectionIds.filter((x) => x !== id) : [...config.connectionIds, id]);
  }

  function addTime() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime) || config.postingTimes.includes(newTime) || config.postingTimes.length >= MAX_POSTING_TIMES) return;
    set("postingTimes", [...config.postingTimes, newTime].sort());
  }

  return (
    <GlassCard as="section" aria-labelledby="autopilot-settings" className="flex flex-col gap-2 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="autopilot-settings" className="text-lg font-semibold tracking-[-0.02em]">
              Autopilot
            </h2>
            <Badge tone={config.enabled ? "success" : "neutral"}>{config.enabled ? "On" : "Off"}</Badge>
          </div>
          <p className="text-[14px] text-muted">Every Friday it plans next week&apos;s posts, each with a picture and a good time. You approve them in one tap.</p>
        </div>
        <Switch
          checked={config.enabled}
          disabled={pending}
          label="Turn Autopilot on"
          onChange={(enabled) => {
            // Switched on with no account chosen yet: it writes for the connected ones (else every app, as reminders),
            // so the first "On" is saved instead of refused.
            const picked = enabled && config.connectionIds.length === 0 ? defaultAccountIds(accounts) : config.connectionIds;
            const next = { ...config, enabled, connectionIds: picked };
            setConfig(next);
            const names = accounts.filter((a) => picked.includes(a.id)).map((a) => a.displayName);
            save(next, !enabled ? "Autopilot is off." : picked !== config.connectionIds && names.length ? `Autopilot is on. It writes for ${names.join(", ")}.` : "Autopilot is on.");
          }}
        />
      </div>

      <hr className="my-2 border-line" />

      <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-1 font-semibold">Accounts to write for</legend>
        {accounts.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[14px] text-muted">No accounts yet. Connect one first.</p>
            <Button href="/dashboard/connections" variant="outline" size="sm">
              Connect an account
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((a) => {
              const on = config.connectionIds.includes(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!a.usable}
                    onClick={() => toggleAccount(a.id)}
                    className={cn(
                      "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50",
                      on ? "border-pulse-blue bg-soft" : "border-line bg-transparent",
                    )}
                  >
                    <AccountAvatar network={a.network} name={a.displayName} src={a.avatarUrl} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{a.displayName}</span>
                      <span className="truncate text-[13px] text-muted">{a.usable ? a.label : `${a.label}: reconnect it first`}</span>
                    </span>
                    <span aria-hidden className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full border", on ? "border-transparent bg-brand-gradient text-white" : "border-line")}>
                      {on && <Check className="size-4" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <hr className="my-2 border-line" />

      <ChoiceChips
        label="Posts per week"
        value={String(config.postsPerWeek)}
        onChange={(v) => set("postsPerWeek", Number(v))}
        items={[...new Set([...WEEK_CHOICES, config.postsPerWeek])].sort((x, y) => x - y).map((n) => ({ value: String(n), label: String(n) }))}
        hint="Each post costs 1 text credit and is written for every account it suits."
        className="[&>p:first-child]:font-semibold [&>p:first-child]:text-[16px]"
      />

      <hr className="my-2 border-line" />

      <div className="flex flex-col gap-3">
        <p className="font-semibold">Posting times</p>
        <ul className="flex flex-wrap gap-2">
          {config.postingTimes.map((t) => (
            <li key={t} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-soft pr-1 pl-4 text-[15px] font-medium tabular-nums">
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                disabled={config.postingTimes.length <= 1}
                onClick={() => set("postingTimes", config.postingTimes.filter((x) => x !== t))}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        {config.postingTimes.length < MAX_POSTING_TIMES && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-muted">Tap to add a time</p>
            <div className="flex flex-wrap items-center gap-2">
              {TIME_IDEAS.filter((t) => !config.postingTimes.includes(t)).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("postingTimes", [...config.postingTimes, t].sort())}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full border-2 border-dashed border-line px-3.5 text-[14px] font-semibold tabular-nums text-muted transition-[border-color,color,transform] duration-200 hover:-translate-y-px hover:border-pulse-blue/50 hover:text-text motion-reduce:transform-none motion-reduce:transition-none"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {t}
                </button>
              ))}
            </div>
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-pulse-blue [&::-webkit-details-marker]:hidden">Another time</summary>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input type="time" aria-label="New posting time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="min-h-11 rounded-2xl border border-line bg-transparent px-3 text-[15px]" />
                <Button type="button" variant="outline" size="sm" leading={<Plus aria-hidden className="size-4" />} onClick={addTime}>
                  Add time
                </Button>
              </div>
            </details>
          </div>
        )}
        <p className="text-[13px] text-muted">Your local time ({timeZone.replace(/_/g, " ")}). Up to {MAX_POSTING_TIMES} times.</p>
      </div>

      <hr className="my-2 border-line" />

      <div className="flex flex-col divide-y divide-line">
        <ToggleRow
          title="Post without asking"
          text="On: posts are scheduled straight away (you can still edit or remove them). Off: they wait for your OK, as set in Posts, Settings."
          checked={config.autoPublish}
          onChange={(v) => set("autoPublish", v)}
        />
        <ToggleRow
          title="AI pictures with people"
          text="On: a unique AI ad for every post (2 image credits for Lite, 4 for Pro; your photos when credits run out). Off: your own photos, no credits."
          checked={config.useAiImages}
          onChange={(v) => set("useAiImages", v)}
        />
      </div>

      <details className="group rounded-2xl border border-line">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-muted" />
          <span className="flex-1 text-[14px] font-semibold">More choices</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="flex flex-col divide-y divide-line px-4">
          <ToggleRow
            title="Skip religious holidays"
            text="Autopilot greets national and cultural days. On: religious holidays are left out."
            checked={config.skipReligious}
            onChange={(v) => set("skipReligious", v)}
          />
          {videoOffer && (
            <div className="py-4">
              <VideoQualityPicker name="autopilot-video-quality" value={config.videoQuality} onChange={(v) => set("videoQuality", v)} offer={videoOffer} />
            </div>
          )}
        </div>
      </details>

      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 pt-2">
        <Button type="button" disabled={pending || !dirty} onClick={() => save(config, "Autopilot settings saved.")}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        <span role="status" className="text-sm text-muted">
          {!dirty && !pending ? "All changes saved" : ""}
        </span>
      </div>
    </GlassCard>
  );
}
