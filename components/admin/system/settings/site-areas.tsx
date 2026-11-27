import { CircleOff, Gift, Hourglass, LoaderCircle, MoveRight } from "lucide-react";
import { ExpandCard, StatusPill } from "@/components/admin/kit";
import { RadioChips, SwitchRow } from "@/components/admin/kit/form-choices";
import { Panel } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui";
import { saveSettingsAction } from "@/app/admin/(console)/(system)/settings/actions";
import { AreaFrame, HowItWorks } from "./area-frame";
import { SETTINGS_TITLE } from "../settings-areas";

type Msg = { ok?: string; bad?: string };

/** /admin/settings/trial: the pre-launch waiting list (lib/waitlist.ts) and how long a new client's free trial lasts. */
export function TrialArea({ trialDays, waitlistOn, waitlistLaunchDate, ok, bad }: Msg & { trialDays: number; waitlistOn: boolean; waitlistLaunchDate: string }) {
  return (
    <AreaFrame icon={Gift} tone="slate" title={SETTINGS_TITLE.trial} description="The waiting list before launch, and how long a new client tries BuPulse for free." ok={ok} bad={bad}>
      <Panel
        id="waitlist"
        icon={Hourglass}
        tone="pink"
        title="Waiting list before launch"
        description="A Christmas banner with a countdown on every public page. Visitors in every country can only reserve a spot; each one gets a thank-you email and shows in Quotes with a Telegram alert."
        action={waitlistOn ? <StatusPill tone="good" dot>On</StatusPill> : <StatusPill tone="muted" dot>Off</StatusPill>}
      >
        <form action={saveSettingsAction} className="flex flex-col gap-4">
          <input type="hidden" name="waitlistPanel" value="1" />
          <SwitchRow name="waitlistOn" defaultChecked={waitlistOn} label="Show the waiting list" hint="While on, nobody can create an account or start a trial by themselves. Logging in still works." />
          <Field label="Launch day" hint="The countdown runs to 00:00 Kigali time on this day." required>
            <Input name="waitlistLaunchDate" type="date" defaultValue={waitlistLaunchDate} required className="w-48" />
          </Field>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
        <ExpandCard title="On launch day" summary="Nothing switches off by itself.">
          <HowItWorks
            items={[
              "When the countdown reaches zero the banner says BuPulse is launching, and the waiting list stays on until you switch it off here.",
              "Switching it off removes the banner and opens sign-up and free trials again. Visitors see the change on their next page.",
              "You can still add companies yourself (Admin → Companies) and start their trials while the list is on.",
            ]}
          />
        </ExpandCard>
      </Panel>
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
