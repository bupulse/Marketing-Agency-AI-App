import { Button, Field, Input, Textarea } from "@/components/ui";
import type { SupportSettings } from "@/lib/support/settings";
import { AI_LIMITS, GREETING_LIMITS, WEEKDAYS } from "@/lib/support/settings-form";
import { Panel } from "../ui";

type Save = (f: FormData) => Promise<void>;

/** Team hours, Kigali time: one range per day here; further ranges saved for a day are kept and listed. */
export function HoursForm({ hours, save }: { hours: SupportSettings["hours"]; save: Save }) {
  return (
    <Panel title="Team hours" description="Kigali time, shown in the chat. Outside them the AI keeps answering; when it hands over, it says when the team opens and that they will reply by email or WhatsApp.">
      <form action={save} className="flex flex-col gap-1">
        {WEEKDAYS.map(({ key, label }) => {
          const ranges = hours[key] ?? [];
          const first = ranges[0] ?? { from: "08:00", to: "20:00" };
          const extra = ranges.slice(1);
          return (
            <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-2.5 first:border-t-0">
              <label className="flex min-h-11 w-40 items-center gap-3 text-[14px] font-medium">
                <input type="checkbox" name={`open_${key}`} defaultChecked={ranges.length > 0} className="size-5" />
                <span>{label}</span>
              </label>
              <span className="flex items-center gap-2 text-[14px] text-muted">
                <Input type="time" name={`from_${key}`} defaultValue={first.from} aria-label={`${label}: opens at`} className="min-h-11 w-32" />
                to
                <Input type="time" name={`to_${key}`} defaultValue={first.to} aria-label={`${label}: closes at`} className="min-h-11 w-32" />
              </span>
              {extra.length > 0 && <span className="text-xs text-muted">Also open {extra.map((r) => `${r.from} to ${r.to}`).join(", ")} (kept)</span>}
            </div>
          );
        })}
        <p className="mt-2 text-xs text-muted">Untick a day to close it. The chat header shows &ldquo;team open until 20:00&rdquo; or when the team opens next.</p>
        <div><Button type="submit" className="mt-2">Save team hours</Button></div>
      </form>
    </Panel>
  );
}

type Greeting = SupportSettings["greetings"][number];

function GreetingRow({ i, g }: { i: number; g: Greeting | null }) {
  return (
    <fieldset className="grid gap-3 rounded-2xl bg-soft p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <legend className="sr-only">{g ? `Greeting for ${g.path}` : "New greeting"}</legend>
      {!g && <p className="text-[13px] font-semibold sm:col-span-2">Add a greeting</p>}
      <Field label="Page" hint={'"/pricing", or "*" for every other page'}><Input name={`g_path_${i}`} defaultValue={g?.path ?? ""} maxLength={GREETING_LIMITS.path} placeholder="/pricing" autoComplete="off" /></Field>
      <Field label="Text"><Input name={`g_text_${i}`} defaultValue={g?.text ?? ""} maxLength={GREETING_LIMITS.text} placeholder="Questions about plans?" /></Field>
      <Field label="Show after (seconds)"><Input name={`g_delay_${i}`} type="number" min={GREETING_LIMITS.minDelay} max={GREETING_LIMITS.maxDelay} step={1} defaultValue={g?.delaySec ?? GREETING_LIMITS.defaultDelay} /></Field>
      <Field label="Quick replies" hint={`One per line, up to ${GREETING_LIMITS.replies}.`}><Textarea name={`g_replies_${i}`} rows={3} defaultValue={g?.quickReplies.join("\n") ?? ""} /></Field>
      {g && (
        <label className="flex min-h-11 items-center gap-3 text-[14px] sm:col-span-2">
          <input type="checkbox" name={`g_remove_${i}`} className="size-5" />
          <span>Remove this greeting</span>
        </label>
      )}
    </fieldset>
  );
}

/** Page greetings: the longest matching page wins, "*" covers every other page. A blank row adds one. */
export function GreetingsForm({ greetings, save }: { greetings: SupportSettings["greetings"]; save: Save }) {
  const full = greetings.length >= GREETING_LIMITS.max;
  return (
    <Panel title="Greetings" description="The small bubble near the chat button, once per visit. Once closed it stays closed for the visit. Never shown on link-in-bio pages.">
      <form action={save} className="flex flex-col gap-3">
        {greetings.map((g, i) => <GreetingRow key={`${i}-${g.path}`} i={i} g={g} />)}
        {!full && <GreetingRow i={greetings.length} g={null} />}
        <div><Button type="submit">Save greetings</Button></div>
      </form>
    </Panel>
  );
}

/** The AI's switch, its tone and policy notes, the topics it always hands to a person, and the WhatsApp number. */
export function AiForm({ settings, save }: { settings: Pick<SupportSettings, "aiEnabled" | "aiRules" | "handoverTopics" | "whatsapp">; save: Save }) {
  return (
    <Panel title="AI rules" description="The AI answers from the BuPulse guide. These notes set its tone and what it never does on its own.">
      <form action={save} className="flex max-w-2xl flex-col gap-4">
        <label className="flex min-h-11 items-start gap-3 text-[14px]">
          <input type="checkbox" name="aiEnabled" defaultChecked={settings.aiEnabled} className="mt-0.5 size-5" />
          <span><span className="font-medium">AI answers</span><span className="block text-[13px] text-muted">Off: the AI does not answer, and every chat waits for a person.</span></span>
        </label>
        <Field label="Rules for the AI" hint={`Tone and policy, in plain words. Up to ${AI_LIMITS.rules} characters.`}><Textarea name="aiRules" rows={8} maxLength={AI_LIMITS.rules} defaultValue={settings.aiRules} /></Field>
        <Field label="Hand-over topics" hint={`One per line, up to ${AI_LIMITS.topics}. The AI passes these chats to a person straight away.`}><Textarea name="handoverTopics" rows={6} defaultValue={settings.handoverTopics.join("\n")} /></Field>
        <Field label="Support WhatsApp number" hint="With the country code, like +250788000000. Leave it empty to hide the Continue on WhatsApp button."><Input name="whatsapp" type="tel" inputMode="tel" maxLength={20} defaultValue={settings.whatsapp} placeholder="+250788000000" /></Field>
        <div><Button type="submit">Save AI rules</Button></div>
      </form>
    </Panel>
  );
}
