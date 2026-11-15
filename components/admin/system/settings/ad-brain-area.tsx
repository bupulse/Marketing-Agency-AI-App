import { HostLink } from "@/components/platform/hosts";
import { Clapperboard, Coins, HardDrive } from "lucide-react";
import { ExpandCard } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui";
import { saveSettingsAction } from "@/app/admin/(console)/(system)/settings/actions";
import { AreaFrame, HowItWorks } from "./area-frame";
import { SETTINGS_TITLE } from "../settings-areas";

/**
 * /admin/settings/ad-brain: the Ad Brain's spend limits ($3 an ad, $30 a month by default) and the BuPulse company
 * account's own Gallery video space (1 GB by default). The ads themselves are made in Admin -> Ad Brain.
 */
export function AdBrainArea({ adBrainPerAdUsd, adBrainMonthlyUsd, adBrainGalleryVideoMb, monthSpentUsd, ok, bad }: { adBrainPerAdUsd: number; adBrainMonthlyUsd: number; adBrainGalleryVideoMb: number; monthSpentUsd: number; ok?: string; bad?: string }) {
  return (
    <AreaFrame
      icon={Clapperboard}
      tone="violet"
      title={SETTINGS_TITLE["ad-brain"]}
      description={
        <>
          BuPulse&apos;s own self-made video ads. An ad stops before passing either limit and says why. Make ads in <HostLink href="/admin/ad-brain">Admin → Ad Brain</HostLink>.
        </>
      }
      ok={ok}
      bad={bad}
    >
      <form action={saveSettingsAction} className="grid items-start gap-5 lg:grid-cols-2">
        <Panel id="ad-brain-limits" icon={Coins} tone="violet" title="Spend limits" description={`This month so far: $${monthSpentUsd.toFixed(2)} of $${adBrainMonthlyUsd.toFixed(2)}.`}>
          <div className="flex flex-col gap-3">
            <Field label="Limit per ad (USD)" hint="The owner's decision: $3.">
              <Input name="adBrainPerAdUsd" type="number" min={0.5} max={50} step={0.1} defaultValue={adBrainPerAdUsd} required />
            </Field>
            <Field label="Limit per month (USD)" hint="The owner's decision: $30.">
              <Input name="adBrainMonthlyUsd" type="number" min={1} max={500} step={1} defaultValue={adBrainMonthlyUsd} required />
            </Field>
          </div>
        </Panel>
        <Panel id="ad-brain-gallery" icon={HardDrive} tone="violet" title="BuPulse's own gallery videos" description="Space for the ads in the company account's Gallery. Other companies keep their normal limit.">
          <div className="flex flex-col gap-3">
            <Field label="Gallery video space (MB)" hint="About 10 MB an ad. The owner's decision: 1,024 MB.">
              <Input name="adBrainGalleryVideoMb" type="number" min={100} max={10000} step={1} defaultValue={adBrainGalleryVideoMb} required />
            </Field>
          </div>
        </Panel>
        <div className="lg:col-span-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
      <ExpandCard title="How the limits work" summary="Checked before every paid call.">
        <HowItWorks
          items={[
            "Before each paid step (a picture, a clip, music, a voice, the judge), the Ad Brain checks that it fits both limits; the whole plan is checked before the first asset.",
            "Every call is in Admin → AI calls and spend under the feature “adBrain”. The site-wide monthly AI cap still applies on top, so keep it above the monthly limit here.",
            "The month is the Kigali calendar month, like the AI budget.",
          ]}
        />
      </ExpandCard>
    </AreaFrame>
  );
}
