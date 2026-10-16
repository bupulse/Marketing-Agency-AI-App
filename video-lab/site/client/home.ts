// Home: the hero video, the engine prices, the showcase grid and the credit packs.
import { $, api, el, rwf } from "./site";

type Item = { id: string; engine: "seedance" | "claude"; title: string; videoUrl: string | null; prompt: string };
type Pricing = { packs: { id: string; name: string; credits: number; rwf: number; blurb: string; popular?: boolean }[]; seedance: { tier: string; name: string; resolution: string; credits5s: number }[]; claudeCredits: number; presenterCredits: number };

async function start() {
  const [{ items }, pricing] = await Promise.all([api<{ items: Item[] }>("/api/showcase"), api<Pricing>("/api/pricing")]);
  const done = items.filter((i) => i.videoUrl);
  const player = $<HTMLVideoElement>("heroPlayer");
  let k = 0;
  const next = () => {
    if (!done.length) return;
    const i = done[k++ % done.length];
    player.src = i.videoUrl as string;
    $("heroTag").textContent = i.engine === "seedance" ? "Seedance 2.0 · real video" : "Motion · designed by Claude";
    void player.play().catch(() => undefined);
  };
  player.onended = next;
  player.loop = false;
  next();
  const grid = $("showcaseGrid");
  for (const i of done.slice(0, 12)) {
    const v = el("video", { src: i.videoUrl as string, muted: true, loop: true, playsInline: true, preload: "metadata" });
    const tile = el("a", { className: "tile", href: "/showcase" }, v, el("span", { className: `eng ${i.engine === "seedance" ? "sd" : "cl"}`, textContent: i.engine === "seedance" ? "Seedance" : "Motion" }), el("div", { className: "cap", textContent: i.title }));
    tile.onmouseenter = () => void v.play().catch(() => undefined);
    tile.onmouseleave = () => v.pause();
    grid.append(tile);
  }
  const fast = pricing.seedance.find((s) => s.tier === "mini" && s.resolution === "480p") ?? pricing.seedance[0];
  $("sdFrom").textContent = String(fast?.credits5s ?? "…");
  $("clCredits").textContent = String(pricing.claudeCredits);
  const packs = $("packs");
  for (const p of pricing.packs) {
    packs.append(
      el("div", { className: `card pack${p.popular ? " hl" : ""}` }, el("h3", { textContent: p.name }), el("div", { className: "amount", textContent: rwf(p.rwf) }), el("div", { className: "per", textContent: `${p.credits.toLocaleString()} credits · ${Math.round(p.rwf / p.credits)} RWF a credit` }), el("p", { className: "muted", textContent: p.blurb }), el("a", { className: "btn primary", href: "/pricing", textContent: "Get credits" })),
    );
  }
}
void start();
