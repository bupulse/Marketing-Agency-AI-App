import { CheckCircle2, ExternalLink, HardDrive, Music, TrendingUp, Upload, Wand2 } from "lucide-react";
import { MusicUpload } from "@/components/admin/music-upload";
import { Button, Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { isMood, MOOD_LABEL, MOODS, platformLimitLabel } from "@/lib/music/tracks";
import { deleteTrackAction, generateMusicBatchAction, generateTrackAction, saveTrendingSoundsAction, setTrackActiveAction } from "@/app/admin/(console)/(content)/music/actions";
import { MAX_TRENDING_TIPS, trendingLines, type TrendingTip } from "@/lib/social/instagram-audio";
import { BATCH_MAX, batchCostUsd, MUSIC_BATCH } from "@/lib/music/batch";
import { CARD, DataList, EmptyState, ExpandCard, FilterChips, PageHeader, StatGrid, StatTile, StatusPill, type SearchParamsLike } from "../kit";
import { FormChips } from "../kit/form-chips";
import { notice } from "../ui";

export type TrackRow = { id: string; title: string; path: string; bytes: number; bpm: number | null; moods: string[]; licence: string; sourceUrl: string; attribution: string | null; active: boolean; platforms?: string[] };

/** Free charts the admin checks each week for new tracks (Pixabay Content License: free for social videos). */
const FREE_PICKS = [
  { label: "Pixabay: popular music", href: "https://pixabay.com/music/search/" },
  { label: "Pixabay: editor's choice", href: "https://pixabay.com/music/search/?order=ec" },
  { label: "Pixabay: newest", href: "https://pixabay.com/music/search/?order=latest" },
  { label: "Pixabay: Afrobeat", href: "https://pixabay.com/music/search/afrobeat/" },
  { label: "Pixabay: upbeat", href: "https://pixabay.com/music/search/upbeat/" },
] as const;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
export const TRACK_FILTERS = ["active", "inactive"] as const;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Music library: three numbers, "Add a track" and "Generate a track" as cards that open, and the tracks as a list
 * (a table on a computer, cards on a phone) with a player, the licence, and Activate / Remove.
 */
export function MusicView({ tracks, urlOf, maxBytes, show, params, message, lastAdded = null, trending = { tips: [], updatedAt: null } }: { tracks: TrackRow[]; urlOf: (path: string) => string; maxBytes: number; show: "" | (typeof TRACK_FILTERS)[number]; params: SearchParamsLike; message: { notice?: string; error?: string }; lastAdded?: string | null; trending?: { tips: TrendingTip[]; updatedAt: string | null } }) {
  const used = tracks.reduce((sum, t) => sum + t.bytes, 0);
  const active = tracks.filter((t) => t.active).length;
  const rows = show === "active" ? tracks.filter((t) => t.active) : show === "inactive" ? tracks.filter((t) => !t.active) : tracks;
  return (
    <>
      <PageHeader icon={Music} tone="pink" title="Music library" description="Royalty-free tracks for content videos. The art director picks one by mood for each video. Only add tracks whose licence allows commercial social media videos, with the source page and the credit line." />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}
      <StatGrid cols={3}>
        <StatTile icon={Music} tone="pink" label="Tracks" value={String(tracks.length)} hint={tracks.length ? "In the library." : "Videos are made without music until tracks are added."} />
        <StatTile icon={CheckCircle2} tone="pink" label="Active" value={String(active)} hint="Picked for new videos. Inactive ones are not." href="/admin/music?show=active" />
        <StatTile icon={HardDrive} tone="pink" label="Space used" value={mb(used)} hint={`Of ${mb(maxBytes)} for the whole library.`} className="max-lg:col-span-2" />
      </StatGrid>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={Upload} tone="pink" title="Add a track" summary="MP3 or M4A, at most 6 MB, with its licence and credit." defaultOpen={tracks.length === 0}>
          <MusicUpload />
        </ExpandCard>
        <ExpandCard icon={Wand2} tone="pink" title="Generate a track" summary="An original instrumental BuPulse owns. Paid per track; at most 20 a day.">
          <form action={generateTrackAction} className="flex flex-col gap-4">
            <p className="text-[13px] text-muted">ElevenLabs Music composes it (paid plan: no credit line needed). The cost goes to the AI cost ledger.</p>
            <Field label="Title" required><Input name="title" maxLength={120} required /></Field>
            <FormChips name="mood" legend="Mood" options={MOODS.map((m) => ({ value: m, label: MOOD_LABEL[m] }))} defaultValue="upbeat" required />
            <Field label="Describe the music" required><Input name="prompt" minLength={10} maxLength={400} required placeholder="Warm afrobeats groove with light percussion and guitar" /></Field>
            <Field label="Length (seconds, at most 60)" required><Input name="seconds" type="number" min={10} max={60} defaultValue={30} required className="max-w-32" /></Field>
            <Button type="submit" className="self-start">Generate a track</Button>
          </form>
        </ExpandCard>
        <ExpandCard icon={Wand2} tone="pink" title="Generate a batch" summary={`The next ${BATCH_MAX} of ${MUSIC_BATCH.length} planned tracks (Afrobeat, calm, inspiring, corporate, celebration, chill). $${batchCostUsd(BATCH_MAX, 30).toFixed(3)} a click.`}>
          <form action={generateMusicBatchAction} className="flex flex-col gap-4">
            <input type="hidden" name="count" value={BATCH_MAX} />
            <input type="hidden" name="seconds" value={30} />
            <input type="hidden" name="confirmUsd" value={batchCostUsd(BATCH_MAX, 30)} />
            <p className="text-[13px] text-muted">
              {BATCH_MAX} tracks of 30 seconds at ElevenLabs Music&apos;s $0.15 a minute: ${batchCostUsd(BATCH_MAX, 30).toFixed(3)}. All {MUSIC_BATCH.length}: ${batchCostUsd(MUSIC_BATCH.length, 30).toFixed(2)} (at most 20 a day). Tracks already in the library are skipped.
            </p>
            <label className="flex min-h-11 items-center gap-3 text-[14px]">
              <input type="checkbox" name="confirm" className="size-5" required /> I accept the cost of ${batchCostUsd(BATCH_MAX, 30).toFixed(3)}
            </label>
            <Button type="submit" className="self-start">Generate {BATCH_MAX} tracks</Button>
          </form>
        </ExpandCard>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={TrendingUp} tone="pink" title="Trending free picks" summary={lastAdded ? `Last track added ${day(lastAdded)}. Check the charts once a week.` : "No track yet. Check the charts once a week."}>
          <div className="flex flex-col gap-3 text-[14px]">
            <p className="text-muted">Once a week, open the free charts, listen to what is new and popular, and add the best fits with &ldquo;Add a track&rdquo; above (licence: Pixabay Content License, no credit line needed).</p>
            <ul className="flex flex-col gap-1">
              {FREE_PICKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-pulse-blue underline">
                    {l.label} <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted">Last track added: {lastAdded ? day(lastAdded) : "none yet"}.</p>
          </div>
        </ExpandCard>
        <ExpandCard icon={Music} tone="pink" title="Trending Instagram sounds this week" summary={trending.tips.length ? `${trending.tips.length} ${trending.tips.length === 1 ? "sound" : "sounds"}${trending.updatedAt ? `, saved ${day(trending.updatedAt)}` : ""}. Shown to clients who post reels by hand.` : "Empty. Shown to clients who post reels by hand."}>
          <form action={saveTrendingSoundsAction} className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">
              Clients whose Instagram cannot take a sound from BuPulse see these when they post a reel themselves. Used only when Meta gives no trending list. One sound per line: Title | Artist | Instagram audio link (artist and link are optional). At most {MAX_TRENDING_TIPS}.
            </p>
            <label htmlFor="trending-sounds" className="sr-only">Trending Instagram sounds, one per line</label>
            <textarea id="trending-sounds" name="sounds" rows={6} defaultValue={trendingLines(trending.tips)} placeholder={"Song title | Artist | https://www.instagram.com/reels/audio/123"} className="min-h-32 rounded-[14px] border border-line bg-glass px-3 py-2 text-[14px] text-text" />
            <Button type="submit" className="self-start">Save the list</Button>
          </form>
        </ExpandCard>
      </div>
      <FilterChips label="Show tracks" param="show" base="/admin/music" params={params} current={show} options={[{ value: "", label: "All", count: tracks.length }, { value: "active", label: "Active", count: active }, { value: "inactive", label: "Inactive", count: tracks.length - active }]} />
      <div className={cn("p-4 sm:p-5 max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none", CARD)}>
        <DataList<TrackRow>
          caption="Music tracks"
          rows={rows}
          rowKey={(t) => t.id}
          columns={[
            { key: "track", header: "Track", primary: true, cell: (t) => <span className="flex flex-col gap-1">{t.title}<audio controls preload="none" src={urlOf(t.path)} className="h-8 w-full max-w-56" /><span className="text-[12px] font-normal text-muted">{mb(t.bytes)}{t.bpm ? ` · ${t.bpm} BPM` : ""}</span></span> },
            { key: "moods", header: "Moods", cell: (t) => t.moods.map((m) => (isMood(m) ? MOOD_LABEL[m] : m)).join(", ") },
            {
              key: "licence",
              header: "Licence and credit",
              cell: (t) => (
                <span className="flex flex-col gap-0.5 text-[13px]">
                  {/^https:\/\//.test(t.sourceUrl) ? <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-pulse-blue underline">{t.licence}</a> : <span className="font-medium">{t.licence} · {t.sourceUrl}</span>}
                  <span className="text-muted">{t.attribution || "No credit line needed"}</span>
                  {platformLimitLabel(t.platforms) && <StatusPill tone="muted">{platformLimitLabel(t.platforms)}</StatusPill>}
                </span>
              ),
            },
            { key: "status", header: "Status", cell: (t) => <StatusPill tone={t.active ? "good" : "muted"} dot>{t.active ? "Active" : "Inactive"}</StatusPill> },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right",
              cell: (t) => (
                <span className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                  <form action={setTrackActiveAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                    <Button type="submit" size="sm" variant="outline">{t.active ? "Deactivate" : "Activate"}</Button>
                  </form>
                  <form action={deleteTrackAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <Button type="submit" size="sm" variant="ghost">Remove</Button>
                  </form>
                </span>
              ),
            },
          ]}
          empty={<EmptyState icon={Music} title={tracks.length ? "No track in this list." : "The library is empty."} hint={tracks.length ? "Pick another chip above." : "Add or generate the first track above."} />}
        />
      </div>
    </>
  );
}
