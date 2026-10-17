// The 3D card carousel of finished videos (the /create hero and the home page's "Made with BuPulse" row), in the style
// of Higgsfield's: the centre card plays, the others show a still one second in (seven videos playing at once is heavy
// for a phone), and it turns every 3.5 s. Each card opens the video in the showcase.
import { el } from "./site";

export type CarouselItem = { id: string; videoUrl: string; engine: string };

export function carousel(box: HTMLElement, items: CarouselItem[]): void {
  box.replaceChildren();
  if (!items.length) {
    box.style.height = "40px";
    return;
  }
  const cards = items.slice(0, 7).map((i) => {
    const c = el("a", { className: "cardV", href: `/showcase#${i.id}` }, el("video", { src: `${i.videoUrl}#t=1`, muted: true, loop: true, playsInline: true, preload: "metadata" }), el("span", { className: "lbl", textContent: i.engine === "seedance" ? "Real video" : i.engine === "blender" ? "Premium 3D" : "Motion" }));
    box.append(c);
    return c;
  });
  let centre = 0;
  const place = () => {
    cards.forEach((c, k) => {
      const d = (((k - centre) % cards.length) + cards.length) % cards.length;
      const off = d > cards.length / 2 ? d - cards.length : d;
      const a = Math.abs(off);
      c.style.transform = `translateX(${off * 250}px) scale(${1 - a * 0.12}) rotateY(${-off * 8}deg)`;
      c.style.opacity = a > 2 ? "0" : String(1 - a * 0.25);
      c.style.zIndex = String(10 - a);
      c.style.filter = a ? "brightness(.6)" : "none";
      const v = c.querySelector("video") as HTMLVideoElement;
      if (a === 0) void v.play().catch(() => undefined);
      else v.pause();
    });
  };
  place();
  setInterval(() => {
    centre = (centre + 1) % cards.length;
    place();
  }, 3500);
}
