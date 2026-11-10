import { Link2, Music, Sparkles, Tv, Upload } from "lucide-react";
import { DataList, EmptyState, ExpandCard, PageHeader, StatusPill } from "@/components/admin/kit";
import { ScreenLinkForm, SoundUpload } from "@/components/admin/screen-forms";
import { Button, Field, Input } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { deleteSoundAction, generateSoundAction, revokeScreenLinkAction, setSoundActiveAction } from "@/app/admin/(console)/(organisation)/organisation/screen/actions";
import { Panel } from "../ui";
import { Notices } from "../system/notices";

export type ScreenLinkRow = { id: string; name: string; createdAt: Date | string; lastSeenAt: Date | string | null; revokedAt: Date | string | null };
export type SoundRow = { id: string; name: string; source: string; bytes: number; active: boolean; url: string | null };

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Admin -> Organisation -> Sales screen: links for the sales room TV, and the sounds that celebrate each payment. */
export function ScreenView({ links, sounds, maxActive, maxSeconds, ok, bad }: { links: ScreenLinkRow[]; sounds: SoundRow[]; maxActive: number; maxSeconds: number; ok?: string; bad?: string }) {
  const live = links.filter((l) => !l.revokedAt).length;
  const active = sounds.filter((s) => s.active).length;
  return (
    <>
      <PageHeader icon={Tv} tone="indigo" title="Sales screen" description="A view-only page for the sales room TV: who uses BuPulse now, revenue today and this month, trials to follow up and the leaderboard. Each new payment is celebrated with a sound. It never shows emails or phone numbers." />
      <Notices ok={ok} bad={bad} />

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Panel icon={Link2} tone="indigo" title="Create a screen link" description="Open it on the TV and press Start screen once (browsers need one click before they play sound). The full address is shown only once.">
          <ScreenLinkForm />
        </Panel>
        <Panel title={`Screen links (${live} live)`} description="Anyone with a link can open the screen, so revoke a link you no longer use. Last seen updates about once a minute.">
          <DataList<ScreenLinkRow>
            caption="Screen links"
            rows={links}
            rowKey={(l) => l.id}
            columns={[
              { key: "name", header: "Name", primary: true, cell: (l) => l.name },
              { key: "status", header: "Status", cell: (l) => (l.revokedAt ? <StatusPill tone="muted" dot>Revoked</StatusPill> : <StatusPill tone="good" dot>Live</StatusPill>) },
              { key: "seen", header: "Last seen", cell: (l) => (l.lastSeenAt ? dateTime(l.lastSeenAt) : "Never") },
              { key: "created", header: "Created", cell: (l) => dateTime(l.createdAt), hideOnPhone: true },
              {
                key: "actions",
                header: <span className="sr-only">Actions</span>,
                align: "right",
                cell: (l) =>
                  !l.revokedAt && (
                    <form action={revokeScreenLinkAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <Button type="submit" size="sm" variant="outline" aria-label={`Revoke ${l.name}`}>
                        Revoke
                      </Button>
                    </form>
                  ),
              },
            ]}
            empty={<EmptyState icon={Tv} title="No links yet." hint="Create one on the left." />}
          />
        </Panel>
      </div>

      <Panel icon={Music} tone="indigo" title={`Celebration sounds (${active} of ${maxActive} active)`} description={sounds.length === 0 ? "No sounds yet: payments are celebrated without sound." : "Active sounds play in turn, oldest first, one per new payment."}>
        <DataList<SoundRow>
          caption="Celebration sounds"
          mode="cards"
          rows={sounds}
          rowKey={(s) => s.id}
          columns={[
            { key: "name", header: "Sound", primary: true, cell: (s) => s.name },
            { key: "play", header: "Listen", cell: (s) => (s.url ? <audio controls preload="none" src={s.url} className="h-11 w-full max-w-64" aria-label={`Play ${s.name}`} /> : <span className="text-[12px] text-muted">Cannot be played right now.</span>) },
            { key: "about", header: "About", cell: (s) => <span className="text-[13px] text-muted">{s.source === "generated" ? "Generated" : "Uploaded"} · {kb(s.bytes)}</span> },
            { key: "status", header: "Status", cell: (s) => (s.active ? <StatusPill tone="good" dot>Active</StatusPill> : <StatusPill tone="muted" dot>Inactive</StatusPill>) },
            {
              key: "actions",
              header: "Actions",
              cell: (s) => (
                <span className="flex flex-wrap gap-2">
                  <form action={setSoundActiveAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                    <Button type="submit" size="sm" variant="outline">{s.active ? "Deactivate" : "Activate"}</Button>
                  </form>
                  <form action={deleteSoundAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" size="sm" variant="ghost">Delete</Button>
                  </form>
                </span>
              ),
            },
          ]}
          empty={<EmptyState icon={Music} title="No sounds yet." hint="Add one or generate one below." />}
        />
      </Panel>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={Upload} tone="indigo" title="Add a sound" summary="An MP3 of a few seconds, at most 1 MB.">
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">Only sounds you hold the rights to.</p>
            <SoundUpload />
          </div>
        </ExpandCard>
        <ExpandCard icon={Sparkles} tone="violet" title="Generate a sound" summary={`ElevenLabs makes an original clip of up to ${maxSeconds} seconds. Paid per sound.`}>
          <form action={generateSoundAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input name="name" maxLength={60} required />
            </Field>
            <Field label={`Length (seconds, at most ${maxSeconds})`} required>
              <Input name="seconds" type="number" min={1} max={maxSeconds} step={0.5} defaultValue={3} required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Describe the sound" required>
                <Input name="prompt" minLength={8} maxLength={300} required placeholder="Cash register ding with coins falling, bright and happy" />
              </Field>
            </div>
            <p className="text-[12.5px] text-muted sm:col-span-2">Paid through the AI cost ledger; at most 20 a day.</p>
            <div className="sm:col-span-2">
              <Button type="submit">Generate a sound</Button>
            </div>
          </form>
        </ExpandCard>
      </div>
    </>
  );
}
