import Link from "next/link";
import { requirePermission } from "@/lib/admin/auth";
import { Clapperboard, Image as ImageIcon, Palette, SlidersHorizontal } from "lucide-react";
import { ChoiceTiles, chosen, ExpandCard, FilterChips, PageHeader } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { param } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import { ASPECT_LABELS, ASPECT_RATIOS, isAspectRatio, type AspectRatio } from "@/lib/designs/layout";
import { designCounts, designsOf, familyOf } from "@/lib/designs/library/catalog";
import { SAMPLE_PALETTES } from "@/lib/designs/library/samples";
import { isPackId, PACKS, type PackId } from "@/lib/designs/packs";
import { videoLookCounts, VIDEO_LOOKS } from "@/lib/visuals/video-looks";
import { LookPreviews } from "./look-previews";

export const metadata = { title: "Design library" };
export const dynamic = "force-dynamic";

const PER_PAGE = 24;

const tab = (active: boolean) =>
  cn("inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border-2 px-3 text-[13px] font-semibold no-underline", active ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:text-text dark:bg-white/[0.03]");

export default async function DesignLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const style: PackId = isPackId(param(sp.style)) ? (param(sp.style) as PackId) : "clean";
  const ratio: AspectRatio = isAspectRatio(param(sp.ratio)) ? (param(sp.ratio) as AspectRatio) : "1:1";
  const photo = param(sp.photo) !== "0";
  const palette = Math.max(0, Math.min(SAMPLE_PALETTES.length - 1, Number(param(sp.palette)) || 0));
  const designs = designsOf(style);
  const pages = Math.max(1, Math.ceil(designs.length / PER_PAGE));
  const page = Math.max(1, Math.min(pages, Number(param(sp.page)) || 1));
  const shown = designs.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const counts = designCounts();
  const looks = videoLookCounts();
  const show = chosen(sp, "show", ["images", "looks"], "images");
  const href = (changes: Record<string, string | number>) => {
    const q = new URLSearchParams({ style, ratio, photo: photo ? "1" : "0", palette: String(palette), page: String(page), ...(show === "looks" ? { show } : {}), ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, String(v)])) });
    return `/admin/designs?${q}`;
  };
  const [w, h] = ratio === "16:9" ? [320, 180] : ratio === "9:16" ? [180, 320] : ratio === "4:5" ? [216, 270] : [240, 240];

  return (
    <>
      <PageHeader
        icon={Palette}
        tone="pink"
        title="Design library"
        description={`Every image design and video look BuPulse can choose for a post, drawn with sample content so quality can be reviewed. Owners never pick: the art director chooses by angle, photo, text length and recent use. ${Object.values(counts).reduce((a, b) => a + b, 0)} designs and ${VIDEO_LOOKS.length} looks in all.`}
      />
      <FilterChips label="Style" param="style" base="/admin/designs" params={sp} current={style} allValue="clean" options={PACKS.map((p) => ({ value: p.id, label: p.name, count: counts[p.id] }))} />
      <ChoiceTiles label="Show" param="show" base="/admin/designs" params={sp} current={show} allValue="images" options={[{ value: "images", label: "Image designs", count: designs.length, hint: "Posts drawn as pictures", icon: ImageIcon, tone: "pink" }, { value: "looks", label: "Video looks", count: looks[style], hint: "Opening scene of each look", icon: Clapperboard, tone: "pink" }]} />
      {show === "images" && (
        <ExpandCard icon={SlidersHorizontal} tone="pink" title="Preview options" summary={`${ASPECT_LABELS[ratio]} ${ratio} · ${photo ? "with sample photo" : "without photo"} · ${SAMPLE_PALETTES[palette]?.name ?? ""}`}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Shape</p>
              <FilterChips label="Shape" param="ratio" base="/admin/designs" params={sp} current={ratio} allValue="1:1" options={ASPECT_RATIOS.map((r) => ({ value: r, label: `${ASPECT_LABELS[r]} ${r}` }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Photo</p>
              <FilterChips label="Photo" param="photo" base="/admin/designs" params={sp} current={photo ? "1" : "0"} allValue="1" options={[{ value: "1", label: "With sample photo" }, { value: "0", label: "Without photo" }]} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Colours</p>
              <FilterChips label="Colours" param="palette" base="/admin/designs" params={sp} current={String(palette)} allValue="0" options={SAMPLE_PALETTES.map((p, i) => ({ value: String(i), label: p.name }))} />
            </div>
          </div>
        </ExpandCard>
      )}

      {show === "images" && <Panel icon={ImageIcon} tone="pink" title={`${PACKS.find((p) => p.id === style)?.name} image designs`} description={`Page ${page} of ${pages}. Thumbnails are drawn on demand and cached in the browser for a day.`}>
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {shown.map((d) => (
            <li key={d.id} className="flex flex-col gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of a generated PNG */}
              <img src={`/admin/designs/thumb?id=${encodeURIComponent(d.id)}&ratio=${encodeURIComponent(ratio)}&photo=${photo ? 1 : 0}&palette=${palette}`} width={w} height={h} loading="lazy" alt={`${d.id} preview`} className="h-auto w-full rounded-2xl border border-line bg-surface" />
              <p className="font-mono text-xs font-semibold">{d.id}</p>
              <p className="text-xs text-muted">
                {familyOf(d.family).name} · {d.needsPhoto ? "needs a photo" : d.usesPhoto ? "photo optional" : "text only"} · fits {d.fits.slice(0, 3).join(", ")}
              </p>
            </li>
          ))}
        </ul>
        <nav aria-label="Pages" className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link key={n} href={href({ page: n })} className={tab(n === page)} aria-current={n === page ? "page" : undefined}>
              {n}
            </Link>
          ))}
        </nav>
      </Panel>}

      {show === "looks" && <Panel icon={Clapperboard} tone="pink" title="Video looks" description="One frame of each look's opening scene, drawn in your browser by the same renderer the videos use (the video robot included).">
        <LookPreviews style={style} ids={VIDEO_LOOKS.filter((l) => l.style === style).map((l) => l.id)} />
      </Panel>}
    </>
  );
}
