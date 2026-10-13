import { PageHeader } from "@/components/app";
import { Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { ScreenLinkForm, SoundUpload } from "@/components/admin/screen-forms";
import { Badge, Button, Field, Input } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { listScreenLinks } from "@/lib/screen/links";
import { MAX_ACTIVE_SOUNDS, SOUND_MAX_SECONDS } from "@/lib/screen/shared";
import { cleanupSoundOrphans, listSounds, soundPlayUrl } from "@/lib/screen/sounds";
import { deleteSoundAction, generateSoundAction, revokeScreenLinkAction, setSoundActiveAction } from "./actions";

export const metadata = { title: "Sales screen" };
export const dynamic = "force-dynamic";

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default async function SalesScreenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("screen.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  await cleanupSoundOrphans();
  const [links, sounds] = await Promise.all([listScreenLinks(), listSounds()]);
  const urls = await Promise.all(sounds.map((s) => soundPlayUrl(s.path)));
  const active = sounds.filter((s) => s.active).length;

  return (
    <>
      <PageHeader
        title="Sales screen"
        description="A view-only page for the sales room TV: who is using BuPulse now, revenue today and this month, trials to follow up and the leaderboard. Each new payment is celebrated on screen with a sound. Anyone with a link can open the screen, so revoke a link you no longer use. It never shows email addresses or phone numbers."
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel title="Create a screen link" description="Open the link on the TV and press Start screen once (browsers need one click before they play sound). The full address is shown only once.">
        <ScreenLinkForm />
      </Panel>

      <Panel title={`Screen links (${links.length})`} description={links.length === 0 ? "No links yet." : "Last seen updates about once a minute while a screen is open."}>
        {links.length > 0 && (
          <TableWrap caption="Screen links">
            <thead>
              <tr><Th>Name</Th><Th>Created</Th><Th>Last seen</Th><Th>Status</Th><Th right>Actions</Th></tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <Td className="font-semibold">{l.name}</Td>
                  <Td>{dateTime(l.createdAt)}</Td>
                  <Td>{l.lastSeenAt ? dateTime(l.lastSeenAt) : "Never"}</Td>
                  <Td>{l.revokedAt ? <Badge tone="neutral">Revoked</Badge> : <Badge tone="success">Live</Badge>}</Td>
                  <Td right>
                    {!l.revokedAt && (
                      <form action={revokeScreenLinkAction} className="flex justify-end">
                        <input type="hidden" name="id" value={l.id} />
                        <Button type="submit" size="sm" variant="outline">Revoke</Button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Add a sound" description={`MP3, at most 1 MB, a few seconds long. Only sounds you hold the rights to. Active: ${active} of ${MAX_ACTIVE_SOUNDS}.`}>
        <SoundUpload />
      </Panel>

      <Panel title="Generate a sound" description={`ElevenLabs Sound Effects makes an original clip of up to ${SOUND_MAX_SECONDS} seconds. Paid per sound through the AI cost ledger; at most 20 a day.`}>
        <form action={generateSoundAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input name="name" maxLength={60} required />
          </Field>
          <Field label={`Length (seconds, at most ${SOUND_MAX_SECONDS})`} required>
            <Input name="seconds" type="number" min={1} max={SOUND_MAX_SECONDS} step={0.5} defaultValue={3} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Describe the sound" required>
              <Input name="prompt" minLength={8} maxLength={300} required placeholder="Cash register ding with coins falling, bright and happy" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit">Generate a sound</Button>
          </div>
        </form>
      </Panel>

      <Panel title={`Sounds (${sounds.length})`} description={sounds.length === 0 ? "No sounds yet: payments are celebrated without sound." : "Active sounds play in turn, oldest first, one per new payment."}>
        {sounds.length > 0 && (
          <TableWrap caption="Celebration sounds">
            <thead>
              <tr><Th>Sound</Th><Th>Source</Th><Th>Size</Th><Th>Status</Th><Th right>Actions</Th></tr>
            </thead>
            <tbody>
              {sounds.map((s, i) => (
                <tr key={s.id}>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">{s.name}</span>
                      {urls[i] ? <audio controls preload="none" src={urls[i] as string} className="h-11 max-w-56" aria-label={`Play ${s.name}`} /> : <span className="text-[12px] text-muted">Cannot be played right now.</span>}
                    </div>
                  </Td>
                  <Td>{s.source === "generated" ? "Generated" : "Uploaded"}</Td>
                  <Td>{kb(s.bytes)}</Td>
                  <Td>{s.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      <form action={setSoundActiveAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                        <Button type="submit" size="sm" variant="outline">{s.active ? "Deactivate" : "Activate"}</Button>
                      </form>
                      <form action={deleteSoundAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <Button type="submit" size="sm" variant="ghost">Delete</Button>
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
