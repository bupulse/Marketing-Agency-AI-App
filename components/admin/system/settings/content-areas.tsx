import { CalendarClock, Clapperboard, Eye, Mic, Sparkles } from "lucide-react";
import { ExpandCard, StatusPill } from "@/components/admin/kit";
import { SwitchRow } from "@/components/admin/kit/form-choices";
import { Panel } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui";
import { saveSettingsAction } from "@/app/admin/(console)/(system)/settings/actions";
import { saveLanguageVoiceAction } from "@/app/admin/(console)/(system)/settings/voice-actions";
import { AreaFrame, HowItWorks } from "./area-frame";
import { SETTINGS_TITLE } from "../settings-areas";

type Msg = { ok?: string; bad?: string };

const onOff = (on: boolean, offLabel = "Off") => (on ? <StatusPill tone="good" dot>On</StatusPill> : <StatusPill tone="muted" dot>{offLabel}</StatusPill>);

/** /admin/settings/content: the switches for what BuPulse makes for clients by itself (each one spends AI money). */
export function ContentArea({
  dailyPosts,
  dailyLine,
  skitVideos,
  firstPostPreview,
  previewCost,
  ok,
  bad,
}: Msg & {
  dailyPosts: boolean;
  dailyLine: string;
  skitVideos: boolean;
  firstPostPreview: boolean;
  previewCost: { model: string; estimateUsd: number | null; made: number; averageUsd: number | null };
}) {
  return (
    <AreaFrame icon={Sparkles} tone="pink" title={SETTINGS_TITLE.content} description="What BuPulse makes for clients by itself. Each switch stops it for everyone at once, so no AI money is spent while it is off." ok={ok} bad={bad}>
      <Panel id="daily-posts" icon={CalendarClock} tone="pink" title="Daily posts for clients" description="Every night BuPulse makes the day's posts for Business and custom plans (and their trials)." action={onOff(dailyPosts, "Paused")}>
        <form action={saveSettingsAction} className="flex flex-col gap-3">
          <input type="hidden" name="dailyPanel" value="1" />
          <SwitchRow name="dailyPosts" defaultChecked={dailyPosts} label="Make daily posts for clients" hint="Within each plan's allowances, each company's AI allowance and the AI budget." />
          <p className="rounded-2xl bg-soft px-4 py-3 text-[13px] text-muted">{dailyLine}</p>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Panel>

      <Panel id="skit-videos" icon={Clapperboard} tone="pink" title="Talking skit videos" description="On skit days (Business: 2 a week, Business Pro: 3) the client records the lines of a short skit BuPulse wrote." action={onOff(skitVideos)}>
        <form action={saveSettingsAction} className="flex flex-col gap-3">
          <input type="hidden" name="skitPanel" value="1" />
          <SwitchRow name="skitVideos" defaultChecked={skitVideos} label="Make skit videos with Higgsfield" hint="Keep it off until the lip-sync test passes." />
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
        <ExpandCard title="What happens on and off" summary="Paid Seedance 2.0 videos when on.">
          <HowItWorks
            items={[
              "On: the client's voice notes go to Seedance 2.0 on Higgsfield (paid, about 10 seconds at 480p each) and the video becomes a post for approval.",
              "Off: skits wait as “Voice received — video coming soon”.",
            ]}
          />
        </ExpandCard>
      </Panel>

      <Panel id="first-post-preview" icon={Eye} tone="pink" title="Free first-post preview" description="On hold: no screen shows it since the free trial starts directly (22 October 2026). The switch is kept for when it gets a new place." action={onOff(firstPostPreview)}>
        <form action={saveSettingsAction} className="flex flex-col gap-3">
          <input type="hidden" name="previewPanel" value="1" />
          <SwitchRow name="firstPostPreview" defaultChecked={firstPostPreview} label="Offer the free first-post preview" hint="On hold: no screen shows it yet." />
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
        <ExpandCard title="What it costs" summary={`About ${previewCost.estimateUsd === null ? "an unknown amount" : `$${previewCost.estimateUsd.toFixed(3)}`} per sign-up that uses it.`}>
          <HowItWorks
            items={[
              `One ${previewCost.model} call of about 2,500 tokens in and 900 out, at the prices in lib/ai/pricing.ts; at most twice that when a first try fails.`,
              previewCost.made > 0 && previewCost.averageUsd !== null ? `Real average so far: $${previewCost.averageUsd.toFixed(4)} over ${previewCost.made} ${previewCost.made === 1 ? "call" : "calls"}.` : "No preview made yet.",
              "One per company; a failed one may be tried once more. It counts in the AI monthly cap and the company allowance like every AI call.",
            ]}
          />
        </ExpandCard>
      </Panel>
    </AreaFrame>
  );
}

/** /admin/settings/voices: the ElevenLabs voice approved for daily videos in Kinyarwanda and Swahili. */
export function VoicesArea({ languages, voices, ok, bad }: Msg & { languages: readonly string[]; voices: Record<string, string | null | undefined> }) {
  return (
    <AreaFrame icon={Mic} tone="pink" title={SETTINGS_TITLE.voices} description="The voice-over voice cannot speak Kinyarwanda or Swahili well, so those videos have music, subtitles and a caption, and no voice-over, until you approve a voice here." ok={ok} bad={bad}>
      <div id="language-voices" className="grid gap-5 lg:grid-cols-2">
        {languages.map((language) => {
          const id = voices[language];
          return (
            <Panel key={language} icon={Mic} tone="pink" title={language} description={id ? `${language} videos speak with this voice.` : `No voice yet: ${language} videos have music and subtitles.`} action={id ? <StatusPill tone="good" dot>Approved</StatusPill> : <StatusPill tone="muted" dot>None</StatusPill>}>
              <form action={saveLanguageVoiceAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="language" value={language} />
                <Field label="ElevenLabs voice id" hint="Clear the box to go back to no voice-over." className="min-w-0 flex-1">
                  <Input name="voiceId" defaultValue={id ?? ""} placeholder="ElevenLabs voice id" pattern="[A-Za-z0-9]{8,40}" />
                </Field>
                <Button type="submit" size="sm">Save</Button>
              </form>
            </Panel>
          );
        })}
      </div>
      <ExpandCard title="How to approve a voice" summary="Listen first, then paste its id.">
        <HowItWorks items={["Listen to an ElevenLabs voice speaking the language.", "If it sounds right, copy its voice id from ElevenLabs and paste it here.", "From then on, daily videos in that language speak with it."]} />
      </ExpandCard>
    </AreaFrame>
  );
}
