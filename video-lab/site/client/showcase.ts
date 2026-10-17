// Showcase and My videos: a grid of finished videos from both engines, with a viewer.
import { $, api, el } from "./site";

type Item = { id: string; engine: "seedance" | "claude" | "blender"; title: string; createdAt: string; status: string; videoUrl: string | null; prompt: string; info: Record<string, string> };

let filter = "all";
let items: Item[] = [];

function render() {
  const grid = $("showcaseGrid");
  grid.replaceChildren();
  const list = items.filter((i) => (filter === "all" ? i.videoUrl : filter === "pending" ? !i.videoUrl && i.status !== "failed" && i.status !== "cancelled" : i.engine === filter && i.videoUrl));
  for (const i of list) {
    const tile = el("div", { className: "tile" });
    if (i.videoUrl) {
      const v = el("video", { src: `${i.videoUrl}#t=1`, muted: true, loop: true, playsInline: true, preload: "metadata" });
      tile.onmouseenter = () => void v.play().catch(() => undefined);
      tile.onmouseleave = () => v.pause();
      tile.append(v);
    } else tile.append(el("div", { className: "cap", textContent: i.status }));
    tile.append(el("span", { className: `eng ${i.engine === "seedance" ? "sd" : "cl"}`, textContent: i.engine === "seedance" ? "Seedance" : i.engine === "blender" ? "Premium 3D" : "Motion" }), el("div", { className: "cap", textContent: i.title }));
    tile.onclick = () => open(i);
    grid.append(tile);
  }
  if (!list.length) grid.append(el("p", { className: "muted", textContent: "Nothing here yet." }));
}

function open(i: Item) {
  const dlg = $("viewer") as HTMLDialogElement;
  $("viewerTitle").textContent = i.title;
  const v = $<HTMLVideoElement>("viewerVideo");
  v.src = i.videoUrl ?? "";
  const dl = $<HTMLAnchorElement>("viewerDl");
  dl.href = i.videoUrl ?? "#";
  dl.hidden = !i.videoUrl;
  $("viewerPrompt").textContent = i.prompt;
  $("viewerInfo").replaceChildren(...Object.entries(i.info).flatMap(([k, val]) => [el("span", { className: "k", textContent: k }), el("span", { textContent: val })]));
  dlg.showModal();
  dlg.onclose = () => v.pause();
}

let first = true;
async function load() {
  items = (await api<{ items: Item[] }>("/api/showcase")).items;
  render();
  // /showcase#<id> (the home page's tiles) opens that video.
  const wanted = first && location.hash.length > 1 ? items.find((i) => i.id === location.hash.slice(1) && i.videoUrl) : undefined;
  first = false;
  if (wanted) open(wanted);
}

$("viewerClose").onclick = () => ($("viewer") as HTMLDialogElement).close();
document.querySelectorAll<HTMLButtonElement>("[data-f]").forEach((b) => {
  b.onclick = () => {
    filter = b.dataset.f ?? "all";
    document.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
    render();
  };
});
void load();
if (document.body.dataset.page === "videos") setInterval(() => void load(), 15_000);
