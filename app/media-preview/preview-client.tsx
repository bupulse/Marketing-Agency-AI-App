"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, Check, Download, Pencil, Trash2 } from "lucide-react";
import { CampaignCard, glassButtonClass, MediaPlayer, PostCard, PostModal, ProductCard, VideoCard, priceLabel, type MediaAction, type PostDetailView } from "@/components/media-cards";
import { VideoLibrary } from "@/components/video-library/video-library";
import { PREVIEW_CREDITS, PREVIEW_POSTS, PREVIEW_VIDEOS } from "./preview-data";

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-4 scroll-mt-6">
      <div>
        <h2 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
        <p className="text-[14px] text-muted">{note}</p>
      </div>
      {children}
    </section>
  );
}

const say = (what: string) => () => window.alert(`Preview: "${what}" does nothing here.`);

/** Our real actions on a post, by its status. */
function postActions(p: PostDetailView): MediaAction[] {
  const list: MediaAction[] = [];
  if (p.status === "pending") list.push({ id: "approve", label: "Approve", icon: <Check />, tone: "primary", onClick: say("Approve") });
  if (p.status === "draft") list.push({ id: "schedule", label: "Schedule", icon: <CalendarClock />, tone: "primary", onClick: say("Schedule") });
  list.push({ id: "edit", label: "Edit", icon: <Pencil />, onClick: say("Edit") });
  list.push({ id: "delete", label: "Delete", icon: <Trash2 />, tone: "danger", onClick: say("Delete"), modalOnly: p.status !== "draft" });
  return list;
}

/**
 * The media cards preview (development only): every card with made-up data. ?theme=dark shows dark mode,
 * ?open=post|video opens the post or the player, ?hover=1 keeps the first video card's glass panel open (screenshots).
 */
export function MediaPreview({ theme, open }: { theme: "light" | "dark"; open: string | null }) {
  const [post, setPost] = useState<number | null>(open === "post" ? 0 : open === "carousel" ? 1 : null);
  const [slide, setSlide] = useState(0);
  const [video, setVideo] = useState<number | null>(open === "video" ? 0 : null);

  useEffect(() => {
    // After the theme provider has applied the saved theme (its effect runs after this one); the player and the opened
    // post render on <body>, outside the page's own `dark` wrapper.
    const html = document.documentElement;
    const was = html.classList.contains("dark");
    const t = window.setTimeout(() => html.classList.toggle("dark", theme === "dark"), 50);
    return () => {
      window.clearTimeout(t);
      html.classList.toggle("dark", was);
    };
  }, [theme]);

  const players = PREVIEW_VIDEOS.map((v) => ({ id: v.key, src: v.videoUrl, poster: v.posterUrl, title: v.title, eyebrow: "Video Studio", ratio: v.ratio, info: <p>{v.caption || "No caption."}</p> }));
  const withActions = new Set(["p1", "p3", "p5", "p7"]);

  return (
    <main className={`min-h-dvh bg-bg px-4 py-8 text-text sm:px-8 ${theme === "dark" ? "dark" : ""}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <header className="flex flex-col gap-2">
          <span className="font-mono text-[12px] tracking-[0.12em] text-pulse-blue uppercase">Development preview</span>
          <h1 className="text-[34px] leading-tight font-bold tracking-[-0.03em]">Media cards</h1>
          <p className="max-w-2xl text-muted">
            Videos, posts, products and campaigns in BuPulse&apos;s new look. Hover a video for the liquid glass, click it for the player; click a post to open it. Made-up data only.
          </p>
          <nav className="flex flex-wrap gap-3 text-[14px] font-semibold text-pulse-blue">
            <a href="#library">Videos library</a>
            <a href="#videos">Video cards</a>
            <a href="#posts">Post cards</a>
            <a href="#products">Products</a>
            <a href="#campaigns">Campaigns</a>
            <a href={theme === "dark" ? "?" : "?theme=dark"}>{theme === "dark" ? "Light mode" : "Dark mode"}</a>
          </nav>
        </header>

        <Section id="library" title="Videos library (wired)" note="components/video-library with LibraryVideo-shaped sample data: the real cards, player and actions. Schedule and Delete need a signed-in company, so they show an error here.">
          <VideoLibrary
            initialVideos={PREVIEW_VIDEOS}
            studio="open"
            credits={PREVIEW_CREDITS}
            canBuy
            reason={null}
            focus={null}
            timeZone="Africa/Kigali"
            upload={{ products: [{ id: "x", name: "Knotless braids" }], storage: { used: 120_000_000, max: 1_000_000_000 } }}
          />
        </Section>

        <Section id="videos" title="VideoCard" note="9:16, 16:9 and 1:1. Statuses, platforms, product, actions slot. Keyboard focus opens the same panel.">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] items-start gap-5">
            {PREVIEW_VIDEOS.slice(0, 3).map((v, i) => (
              <VideoCard
                key={v.key}
                index={i}
                video={{ src: v.videoUrl, poster: v.posterUrl, durationMs: v.durationMs, ratio: "9:16" }}
                title={v.title}
                eyebrow={i === 0 ? "Video Studio · AI video" : i === 1 ? "Daily slideshow" : "Uploaded"}
                status={i === 0 ? "new" : i === 1 ? "scheduled" : "posted"}
                statusLabel={i === 1 ? "Scheduled · Fri 12:30" : null}
                platforms={i === 1 ? ["instagram", "facebook", "tiktok"] : ["instagram"]}
                product={i === 1 ? "Knotless braids" : null}
                dateLabel="Made 10 Nov 2026"
                note={v.caption}
                onOpen={() => setVideo(i)}
                actions={
                  <>
                    <button type="button" className={glassButtonClass("primary")} onClick={say("Schedule")}>
                      <CalendarClock aria-hidden className="size-4" />
                      Schedule
                    </button>
                    <button type="button" className={glassButtonClass()} onClick={say("Download")}>
                      <Download aria-hidden className="size-4" />
                      Download
                    </button>
                  </>
                }
              />
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <VideoCard video={{ src: PREVIEW_VIDEOS[3].videoUrl, durationMs: 12_500, ratio: "16:9" }} title="Wide video (16:9) for YouTube and LinkedIn" eyebrow="Video Studio · Motion" status="ready" platforms={["youtube", "linkedin"]} onOpen={() => setVideo(3)} />
            <VideoCard video={{ src: PREVIEW_VIDEOS[4].videoUrl, durationMs: 12_500, ratio: "1:1" }} title="Square video (1:1)" eyebrow="Video Studio · Premium 3D" status="failed" statusLabel="Failed to post" onOpen={() => setVideo(4)} className="max-w-sm" />
          </div>
        </Section>

        <Section id="posts" title="PostCard" note="Feed posts per platform: Instagram (picture, carousel, video), Facebook, LinkedIn, X, TikTok. Some show our real actions instead of the like row.">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] items-start gap-5">
            {PREVIEW_POSTS.map((p, i) => (
              <PostCard
                key={p.id}
                index={i}
                post={p}
                actions={withActions.has(p.id) ? postActions(p) : undefined}
                onOpen={(s) => {
                  setSlide(s ?? 0);
                  setPost(i);
                }}
              />
            ))}
          </div>
        </Section>

        <Section id="products" title="ProductCard" note="Products and services from Business info: photo, kind, price; glass panel with numbers and actions on hover (under the card on phones).">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-5">
            <ProductCard index={0} name="Weekend brunch" imageUrl="/marketing/photos/industry-restaurants-480.webp" price={priceLabel("FROM", 6000, "RWF")} summary="Eggs, fresh bread and house coffee, Saturday and Sunday mornings." category="Food" kindLabel="Product" stats={[{ label: "Posts", value: "12" }, { label: "Last post", value: "2d" }]} actions={[{ id: "post", label: "Make a post", icon: <Pencil />, tone: "primary", onClick: say("Make a post") }, { id: "edit", label: "Edit", onClick: say("Edit") }]} href="#products" />
            <ProductCard index={1} name="Knotless braids" imageUrl="/marketing/photos/industry-beauty-480.webp" price={priceLabel("FIXED", 25000, "RWF")} priceNote="3 to 4 hours" summary="Light, neat braids that last six weeks." category="Beauty" kindLabel="Service" stats={[{ label: "Posts", value: "8" }]} actions={[{ id: "post", label: "Make a post", icon: <Pencil />, tone: "primary", onClick: say("Make a post") }]} onOpen={say("Open")} />
            <ProductCard index={2} name="Cement 50 kg" imageUrl="/marketing/photos/industry-construction-480.webp" price={priceLabel("PER_UNIT", 11500, "RWF")} priceNote="Discount from 20 bags" summary="Delivered across Kigali the same day." category="Building" kindLabel="Product" status="draft" onOpen={say("Open")} />
            <ProductCard index={3} name="Phone repair" price={priceLabel("ON_REQUEST", null, "RWF")} summary="Screens, batteries and charging ports." kindLabel="Service" />
          </div>
        </Section>

        <Section id="campaigns" title="CampaignCard" note="Creator campaigns paid by views (ring = views against the target, bar = budget) and Business info offers and events.">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-5">
            <CampaignCard index={0} name="Show us your brunch" coverUrl="/marketing/photos/industry-restaurants-720.webp" status="live" kindLabel="Creator campaign · Challenge" platforms={["instagram", "tiktok"]} dates={{ start: "2026-11-10", end: "2026-11-27", today: "2026-11-13" }} metric={{ label: "views", value: 18_400, target: 50_000 }} budget={{ spent: 92_000, total: 250_000, currency: "RWF" }} creators={8} actions={[{ id: "open", label: "Open", tone: "primary", onClick: say("Open") }, { id: "pause", label: "Pause", onClick: say("Pause") }]} href="#campaigns" />
            <CampaignCard index={1} name="Braids review week" coverUrl="/marketing/photos/industry-beauty-720.webp" status="draft" statusLabel="Draft · step 4 of 12" kindLabel="Creator campaign · Product review" platforms={["instagram"]} dates={{ start: "2026-11-20", end: "2026-11-30", today: "2026-11-13" }} metric={{ label: "views", value: 0, target: 20_000 }} creators={0} actions={[{ id: "cont", label: "Continue", tone: "primary", onClick: say("Continue") }]} />
            <CampaignCard index={2} name="Black Friday: 20% off" status="ended" kindLabel="Offer" line="20% off every phone, trade-ins welcome." dates={{ start: "2026-10-27", end: "2026-11-03" }} metric={{ label: "posts made", value: 9, target: 12 }} />
          </div>
        </Section>
      </div>

      <PostModal posts={PREVIEW_POSTS} index={post} onIndexChange={(i) => { setSlide(0); setPost(i); }} onClose={() => setPost(null)} actionsFor={(p) => (withActions.has(p.id) ? postActions(p) : [])} startSlide={slide} />
      <MediaPlayer items={players} index={video} onIndexChange={setVideo} onClose={() => setVideo(null)} />
    </main>
  );
}
