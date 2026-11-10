import { CircleOff, Gift, LoaderCircle, MoveRight } from "lucide-react";
import { ExpandCard } from "@/components/admin/kit";
import { RadioChips } from "@/components/admin/kit/form-choices";
import { Panel } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui";
import { saveSettingsAction } from "@/app/admin/(console)/(system)/settings/actions";
import { AreaFrame, HowItWorks } from "./area-frame";
import { SETTINGS_TITLE } from "../settings-areas";

type Msg = { ok?: string; bad?: string };

/** /admin/settings/trial: how long a new client's free trial lasts. */
export function TrialArea({ trialDays, ok, bad }: Msg & { trialDays: number }) {
  return (
    <AreaFrame icon={Gift} tone="slate" title={SETTINGS_TITLE.trial} description="How long a new client tries BuPulse for free." ok={ok} bad={bad}>
      <Panel title="Trial length" description="A trial starts when the client picks the plan to try (right after onboarding, no demo needed).">
        <form action={saveSettingsAction} className="flex flex-wrap items-end gap-3">
          <Field label="Days" required>
            <Input name="trialDays" type="number" min={1} max={90} defaultValue={trialDays} required className="w-28" />
          </Field>
          <Button type="submit">Save</Button>
        </form>
      </Panel>
      <ExpandCard title="Good to know" summary="Start trial on Demos does the same for older sign-ups.">
        <HowItWorks items={["Start trial (on Demos, or the company page) starts the same trial for a company still waiting from the demo-first days.", "The TRIAL plan's own length no longer drives sign-ups: this number does."]} />
      </ExpandCard>
    </AreaFrame>
  );
}

/** /admin/settings/loading: the animation shown while a page loads, on the whole site. */
export function LoadingArea({ pageLoader, ok, bad }: Msg & { pageLoader: string }) {
  return (
    <AreaFrame icon={LoaderCircle} tone="slate" title={SETTINGS_TITLE.loading} description="Shown on the whole site (public pages, client dashboard and admin) while a page loads. Visitors see a change within a minute." ok={ok} bad={bad}>
      <Panel title="Pick the animation">
        <form action={saveSettingsAction} className="flex flex-col gap-4">
          <RadioChips
            name="pageLoader"
            legend="Animation"
            hideLegend
            tiles
            required
            defaultValue={pageLoader}
            options={[
              { value: "bar", label: "Bar across the top", hint: "A thin line runs left to right.", icon: MoveRight, tone: "blue" },
              { value: "preloader", label: "BuPulse preloader", hint: "The logo with a spinning ring.", icon: LoaderCircle, tone: "violet" },
              { value: "off", label: "Off", hint: "Nothing while pages load.", icon: CircleOff, tone: "slate" },
            ]}
          />
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Panel>
    </AreaFrame>
  );
}
