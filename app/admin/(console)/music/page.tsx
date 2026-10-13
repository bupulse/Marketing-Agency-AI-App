import { PageHeader } from "@/components/app";
import { Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { MusicUpload } from "@/components/admin/music-upload";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listTracks, MUSIC_LIBRARY_MAX_BYTES, musicUrl } from "@/lib/music/service";
import { isMood, MOOD_LABEL, MOODS } from "@/lib/music/tracks";
import { deleteTrackAction, generateTrackAction, setTrackActiveAction } from "./actions";

export const metadata = { title: "Music library" };
export const dynamic = "force-dynamic";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default async function MusicPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const tracks = await listTracks();
  const used = tracks.reduce((sum, t) => sum + t.bytes, 0);

  return (
    <>
      <PageHeader
        title="Music library"
        description="Royalty-free tracks for content videos. The art director picks one by mood for each video and the owner can change or remove it. Every track needs its licence, its source page and the credit line the licence asks for. Only upload tracks whose licence allows use in commercial social media videos."
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <Panel title="Add a track" description={`MP3 or M4A, at most 6 MB. Library: ${mb(used)} of ${mb(MUSIC_LIBRARY_MAX_BYTES)}.`}>
        <MusicUpload />
      </Panel>
      <Panel title="Generate a track" description="ElevenLabs Music composes an original instrumental that BuPulse owns (paid plan: no credit line needed). Paid per track through the AI cost ledger; at most 20 a day.">
        <form action={generateTrackAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required>
            <Input name="title" maxLength={120} required />
          </Field>
          <Field label="Mood" required>
            <Select name="mood" defaultValue="upbeat">
              {MOODS.map((m) => (
                <option key={m} value={m}>{MOOD_LABEL[m]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Describe the music" required>
            <Input name="prompt" minLength={10} maxLength={400} required placeholder="Warm afrobeats groove with light percussion and guitar" />
          </Field>
          <Field label="Length (seconds, at most 60)" required>
            <Input name="seconds" type="number" min={10} max={60} defaultValue={30} required />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">Generate a track</Button>
          </div>
        </form>
      </Panel>
      <Panel title={`Tracks (${tracks.length})`} description={tracks.length === 0 ? "The library is empty: videos are made without music until tracks are added." : "Inactive tracks are not picked for new videos."}>
        {tracks.length > 0 && (
          <TableWrap caption="Music tracks">
            <thead>
              <tr><Th>Track</Th><Th>Moods</Th><Th>Licence and credit</Th><Th>Status</Th><Th right>Actions</Th></tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">{t.title}</span>
                      <audio controls preload="none" src={musicUrl(t.path)} className="h-8 max-w-56" />
                      <span className="text-[12px] text-muted">{mb(t.bytes)}{t.bpm ? ` · ${t.bpm} BPM` : ""}</span>
                    </div>
                  </Td>
                  <Td>{t.moods.map((m) => (isMood(m) ? MOOD_LABEL[m] : m)).join(", ")}</Td>
                  <Td>
                    <div className="flex flex-col gap-1 text-[13px]">
                      {/^https:\/\//.test(t.sourceUrl) ? (
                        <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-pulse-blue underline">{t.licence}</a>
                      ) : (
                        <span className="font-medium">{t.licence} · {t.sourceUrl}</span>
                      )}
                      <span className="text-muted">{t.attribution || "No credit line needed"}</span>
                    </div>
                  </Td>
                  <Td>{t.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      <form action={setTrackActiveAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                        <Button type="submit" size="sm" variant="outline">{t.active ? "Deactivate" : "Activate"}</Button>
                      </form>
                      <form action={deleteTrackAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <Button type="submit" size="sm" variant="ghost">Remove</Button>
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
