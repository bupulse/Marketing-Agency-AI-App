// "Get inspired" (docs/VIDEO_ENGINE.md, "Seedance"): example Seedance storyboards made from the test businesses'
// products, like seedance2ai's example gallery. Hover flips through a storyboard's frames; a card opens the shot list,
// the price per quality and "Use this", which opens the generator with the prompt, the shape, the length and the
// product already chosen. The frames are SVG shown as images, so nothing inside them can run.
import { $, api, el } from "./site";

type Frame = { at: number; shot: number; caption: string; svg: string };
type Shot = { from: number; to: number; shot: string; camera: string; action: string; sound: string | null; spoken: string | null; references: string[] };
type Example = {
  id: string;
  title: string;
  sector: string;
  format: string;
  seconds: number;
  ratio: string;
  prompt: string;
  notes: string[];
  storyboard: { notice: string; frames: Frame[]; shots: Shot[]; references: { kind: string }[]; setting: string | null };
  credits: { tier: string; name: string; resolution: string; credits: number }[];
  source: { businessId: string; businessName: string; productId: string; productName: string };
};
type Named = { id: string; name: string };

const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const state = { examples: [] as Example[], sectors: [] as Named[], formats: [] as Named[], sector: "all", format: "all", loaded: false };
const nameOf = (list: Named[], id: string) => list.find((x) => x.id === id)?.name ?? id;
const cheapest = (e: Example) => Math.min(...e.credits.map((c) => c.credits));

/** The generator, ready to film this example: Seedance, the prompt, 9:16, its length, its product and photos. */
function generatorLink(e: Example): string {
  const q = new URLSearchParams({ engine: "seedance", prompt: e.prompt, ratio: "9:16", seconds: String(e.seconds), business: e.source.businessId, product: e.source.productId, photos: String(e.storyboard.references.filter((r) => r.kind === "image").length) });
  return `/create?${q}`;
}

function chips(list: Named[], current: string, set: (id: string) => void): HTMLElement {
  const row = el("div", { className: "pills" });
  for (const x of [{ id: "all", name: "All" }, ...list.filter((x) => state.examples.some((e) => e.sector === x.id || e.format === x.id))]) {
    const b = el("button", { className: `btn sm${x.id === current ? " on" : ""}`, textContent: x.name });
    b.onclick = () => {
      set(x.id);
      render();
    };
    row.append(b);
  }
  return row;
}

function card(e: Example): HTMLElement {
  // Each frame draws its own label (shot number, time, shot type, camera); the full caption is the tooltip.
  const img = el("img", { src: e.storyboard.frames[0] ? svgSrc(e.storyboard.frames[0].svg) : "", alt: e.title, loading: "lazy", title: e.storyboard.frames[0]?.caption ?? "" });
  const c = el(
    "button",
    { className: "inCard" },
    el("div", { className: "thumb" }, img),
    el("div", { className: "nm" }, el("b", { textContent: e.title }), el("div", { className: "tags" }, el("span", { className: "chip", textContent: nameOf(state.sectors, e.sector) }), el("span", { className: "chip", textContent: nameOf(state.formats, e.format) })), el("span", { className: "price", textContent: `from ${cheapest(e)} credits · ${e.seconds} s` })),
  );
  // Hover flips through the frames with their labels.
  let timer = 0;
  let k = 0;
  c.onmouseenter = () => {
    clearInterval(timer);
    timer = window.setInterval(() => {
      k = (k + 1) % Math.max(1, e.storyboard.frames.length);
      img.src = svgSrc(e.storyboard.frames[k].svg);
      img.title = e.storyboard.frames[k].caption;
    }, 900);
  };
  c.onmouseleave = () => clearInterval(timer);
  c.onclick = () => open(e);
  return c;
}

function open(e: Example) {
  const dlg = $("inspireDlg") as HTMLDialogElement;
  $("inspireTitle").textContent = e.title;
  const shots = el("table", { className: "shots" }, el("tr", {}, ...["Time", "Shot", "Camera", "What happens"].map((h) => el("th", { textContent: h }))));
  for (const s of e.storyboard.shots) {
    const what = el("td", {}, s.action);
    if (s.spoken) what.append(el("div", { className: "muted", textContent: `Says: "${s.spoken}"` }));
    if (s.sound) what.append(el("div", { className: "muted", textContent: `Sound: ${s.sound}` }));
    shots.append(el("tr", {}, el("td", { textContent: `${s.from}–${s.to} s` }), el("td", { textContent: s.shot }), el("td", { textContent: s.camera }), what));
  }
  const prices = el("table", { className: "rates" }, el("tr", {}, ...["Quality", "Resolution", `${e.seconds} s clip`].map((h) => el("th", { textContent: h }))));
  for (const c of e.credits) prices.append(el("tr", {}, el("td", { textContent: c.name }), el("td", { textContent: c.resolution }), el("td", { textContent: `${c.credits} credits (${(c.credits * 10).toLocaleString()} RWF)` })));
  const use = el("a", { className: "btn primary", href: generatorLink(e), textContent: "Use this" });
  $("inspireBody").replaceChildren(
    el("div", { className: "pvNotice", textContent: e.storyboard.notice }),
    el("div", { className: "frames four" }, ...e.storyboard.frames.map((f) => el("figure", {}, el("img", { src: svgSrc(f.svg), alt: f.caption }), el("figcaption", { textContent: f.caption })))),
    el("p", { className: "muted small", textContent: `${nameOf(state.sectors, e.sector)} · ${nameOf(state.formats, e.format)} · made from ${e.source.productName} (${e.source.businessName})${e.storyboard.setting ? ` · ${e.storyboard.setting}` : ""}` }),
    el("h5", { textContent: "Shot list" }),
    shots,
    ...(e.notes.length ? [el("h5", { textContent: "Notes" }), el("ul", { className: "muted" }, ...e.notes.map((n) => el("li", { textContent: n })))] : []),
    el("h5", { textContent: "What the real clip costs" }),
    prices,
    el("details", {}, el("summary", { className: "muted", textContent: "The prompt" }), el("pre", { className: "promptPre", textContent: e.prompt })),
    el("div", { className: "row", style: "margin-top:14px" }, use),
  );
  dlg.showModal();
}

function render() {
  $("inspireFilters").replaceChildren(
    chips(state.sectors, state.sector, (id) => (state.sector = id)),
    chips(state.formats, state.format, (id) => (state.format = id)),
  );
  const list = state.examples.filter((e) => (state.sector === "all" || e.sector === state.sector) && (state.format === "all" || e.format === state.format));
  $("inspireGrid").replaceChildren(...list.map(card));
  if (!list.length) $("inspireGrid").append(el("p", { className: "muted", textContent: state.examples.length ? "No example for this choice yet." : "No examples yet." }));
}

/** Shows the gallery (Real video) or hides it (Motion). Loads the examples the first time. */
export async function showInspire(visible: boolean): Promise<void> {
  const section = document.getElementById("inspire");
  if (!section) return;
  section.hidden = !visible;
  if (!visible || state.loaded) return;
  state.loaded = true;
  try {
    const out = await api<{ examples: Example[]; sectors: Named[]; formats: Named[] }>("/api/seedance/examples");
    Object.assign(state, { examples: out.examples, sectors: out.sectors, formats: out.formats });
    render();
  } catch (e) {
    state.loaded = false;
    $("inspireGrid").replaceChildren(el("p", { className: "err", textContent: (e as Error).message }));
  }
}

export function setupInspire(): void {
  const close = document.getElementById("inspireClose");
  if (close) close.onclick = () => ($("inspireDlg") as HTMLDialogElement).close();
}
