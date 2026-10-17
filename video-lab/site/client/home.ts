// Home: the hero video, the model cards' prices, the showcase grid and the credit packs.
import { loadPricing } from "./models";
import { $, api, el, rwf } from "./site";

type Item = { id: string; engine: "seedance" | "claude" | "blender"; title: string; videoUrl: string | null; prompt: string };

async function start() {
  const [{ items }, pricing] = await Promise.all([api<{ items: Item[] }>("/api/showcase"), loadPricing()]);
  const done = items.filter((i) => i.videoUrl);
  const player = $<HTMLVideoElement>("heroPlayer");
  let k = 0;
  const next = () => {
    if (!done.length) return;
    const i = done[k++ % done.length];
    player.src = i.videoUrl as string;
    $("heroTag").textContent = i.engine === "seedance" ? "Seedance 2.0 · real video" : "Claude 3D motion";
    void player.play().catch(() => undefined);
  };
  player.onended = next;
  player.loop = false;
  next();
  const grid = $("showcaseGrid");
  for (const i of done.slice(0, 12)) {
    const v = el("video", { src: `${i.videoUrl}#t=1`, muted: true, loop: true, playsInline: true, preload: "metadata" });
    const tile = el("a", { className: "tile", href: `/showcase#${i.id}` }, v, el("span", { className: `eng ${i.engine === "seedance" ? "sd" : "cl"}`, textContent: i.engine === "seedance" ? "Seedance" : i.engine === "blender" ? "Premium 3D" : "Motion" }), el("div", { className: "cap", textContent: i.title }));
    tile.onmouseenter = () => void v.play().catch(() => undefined);
    tile.onmouseleave = () => v.pause();
    grid.append(tile);
  }
  if (!done.length) grid.append(el("p", { className: "muted", textContent: "No finished videos yet: make the first one." }));
  const packs = $("packs");
  for (const p of pricing.packs) {
    packs.append(
      el("div", { className: `card pack${p.popular ? " hl" : ""}` }, el("h3", { textContent: p.name }), el("div", { className: "amount", textContent: rwf(p.rwf) }), el("div", { className: "per", textContent: `${p.credits.toLocaleString()} credits · ${Math.round(p.rwf / p.credits)} RWF a credit` }), el("p", { className: "muted", textContent: p.blurb }), el("a", { className: "btn primary", href: `/pricing#pack-${p.id}`, textContent: "Get credits" })),
    );
  }
}
void start();
