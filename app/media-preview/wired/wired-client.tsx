"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PostBoard } from "@/components/content-board/post-board";
import { DesignStudio } from "@/components/designs/design-studio";
import { MediaTile } from "@/components/media-cards";
import { Calendar } from "@/components/publishing/calendar";
import { BOARD, CONTEXT, DESIGNS, NOW_ISO, TILES, TODAY, ZONE } from "./wired-data";

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-4">
      <div>
        <h2 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
        <p className="text-[14px] text-muted">{note}</p>
      </div>
      {children}
    </section>
  );
}

/** The wired client components with made-up rows (development only). ?open=<post id> opens that post. */
export function WiredPreview({ theme, open, server }: { theme: "light" | "dark"; open: string | null; server: ReactNode }) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const html = document.documentElement;
    const was = html.classList.contains("dark");
    const t = window.setTimeout(() => html.classList.toggle("dark", theme === "dark"), 50);
    return () => {
      window.clearTimeout(t);
      html.classList.toggle("dark", was);
    };
  }, [theme]);
  const openPost = BOARD.find((p) => p.id === open) ?? null;
  return (
    <main className={`min-h-dvh bg-bg px-4 py-8 text-text sm:px-8 ${theme === "dark" ? "dark" : ""}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <header className="flex flex-col gap-2">
          <span className="font-mono text-[12px] tracking-[0.12em] text-pulse-blue uppercase">Development preview</span>
          <h1 className="text-[34px] leading-tight font-bold tracking-[-0.03em]">Wired pages</h1>
          <p className="max-w-2xl text-muted">The real page components with made-up rows. Buttons that save need a signed-in company, so they show an error here.</p>
          <nav className="flex flex-wrap gap-3 text-[14px] font-semibold text-pulse-blue">
            <a href="#board">Posts board</a>
            <a href="#calendar">Calendar</a>
            <a href="#products">Products</a>
            <a href="#creators">Creator campaigns</a>
            <a href="#designs">Designs</a>
            <a href="#photos">Photos</a>
          </nav>
        </header>
        <Section id="board" title="Posts board (PostBoard + PostCard + PostDetail)" note="components/content-board: select mode, making screen, chips, notes, Use again and WhatsApp kept. A card opens the post; previous and next walk the board.">
          <PostBoard posts={BOARD} zone={ZONE} context={CONTEXT} total={BOARD.length} moreHref={null} openPost={openPost} empty={null} showSubject />
        </Section>
        <Section id="calendar" title="Calendar" note="components/publishing/calendar: a post opens the opened-post view with that day's posts.">
          <Calendar posts={BOARD.filter((p) => p.scheduledAt || p.publishedAt)} context={CONTEXT} todayKey={TODAY} nowIso={NOW_ISO} />
        </Section>
        {server}
        <Section id="designs" title="Designs (DesignStudio)" note="components/designs/design-studio: every design whole in a fixed square tile.">
          <DesignStudio designs={DESIGNS} timeZone={ZONE} />
        </Section>
        <Section id="photos" title="Photos tiles (MediaTile)" note="components/media/gallery-view uses this tile: fixed square, lift, glass name label, video preview.">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {TILES.map((t, i) => (
              <li key={t.name}>
                <MediaTile index={i} item={{ url: t.url, kind: t.kind, durationMs: t.durationMs }} label={t.name} selected={picked === t.name} onClick={() => setPicked(t.name)} ariaLabel={`Open ${t.name}`} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
