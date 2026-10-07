"use client";

import { Check, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { saveAutopilotSettings } from "@/app/dashboard/autopilot/actions";
import { AccountAvatar } from "@/components/publishing/network-icon";
import { Badge, Button, GlassCard, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AutopilotConfig } from "@/lib/autopilot/settings";
import { MAX_POSTING_TIMES, MAX_POSTS_PER_WEEK, MIN_POSTS_PER_WEEK } from "@/lib/autopilot/settings";
import type { ViewAccount } from "@/lib/autopilot/view";
import { Switch } from "./switch";

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
export function SettingsCard({ initial, accounts, timeZone }: { initial: AutopilotConfig; accounts: ViewAccount[]; timeZone: string }) {
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
          <p className="text-[14px] text-muted">
            Every Friday, Autopilot plans next week&apos;s posts for your accounts. Each one is written for its network, comes with a picture from your photos and a free brand template, and is set for a good time. You approve them in one tap.
          </p>
        </div>
        <Switch
          checked={config.enabled}
          disabled={pending}
          label="Turn Autopilot on"
          onChange={(enabled) => {
            const next = { ...config, enabled };
            setConfig(next);
            save(next, enabled ? "Autopilot is on." : "Autopilot is off.");
          }}
        />
      </div>

      <hr className="my-2 border-line" />

      <fieldset className="flex flex-col gap-3 border-0 p-0">
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

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="posts-per-week" className="font-semibold">
            Posts per week
          </label>
          <output htmlFor="posts-per-week" className="text-2xl font-semibold tabular-nums">
            {config.postsPerWeek}
          </output>
        </div>
        <input
          id="posts-per-week"
          type="range"
          min={MIN_POSTS_PER_WEEK}
          max={MAX_POSTS_PER_WEEK}
          step={1}
          value={config.postsPerWeek}
          onChange={(e) => set("postsPerWeek", Number(e.target.value))}
          className="h-11 w-full cursor-pointer accent-pulse-blue"
        />
        <p className="text-[14px] text-muted">
          Each post is written for every account it suits, and costs 1 text credit. Between {MIN_POSTS_PER_WEEK} and {MAX_POSTS_PER_WEEK}.
        </p>
      </div>

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
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="time"
            aria-label="New posting time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            className="min-h-11 rounded-2xl border border-line bg-transparent px-3 text-[15px]"
          />
          <Button type="button" variant="outline" size="sm" leading={<Plus aria-hidden className="size-4" />} onClick={addTime} disabled={config.postingTimes.length >= MAX_POSTING_TIMES}>
            Add time
          </Button>
        </div>
        <p className="text-[14px] text-muted">Local time ({timeZone.replace(/_/g, " ")}). Autopilot spreads posts over the week and uses what works best for you once it has results.</p>
      </div>

      <hr className="my-2 border-line" />

      <div className="flex flex-col divide-y divide-line">
        <ToggleRow
          title="Post without asking"
          text="Off: posts wait for you and go out only after you approve them (recommended). On: Autopilot schedules them straight away, and you can still edit or remove them before they go out."
          checked={config.autoPublish}
          onChange={(v) => set("autoPublish", v)}
        />
        <ToggleRow
          title="Use AI images (uses image credits)"
          text="Off: your own photos in free brand templates. On: Autopilot creates a new picture for each post, using 1 image credit each. It falls back to free templates when credits run out."
          checked={config.useAiImages}
          onChange={(v) => set("useAiImages", v)}
        />
        <ToggleRow
          title="Skip religious holidays"
          text="Autopilot greets national and cultural days. Switch this on to leave religious holidays out."
          checked={config.skipReligious}
          onChange={(v) => set("skipReligious", v)}
        />
      </div>

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
