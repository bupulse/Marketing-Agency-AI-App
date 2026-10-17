// The AI image page (/app/image/nano-banana): a prompt and up to 3 reference photos (product photos or uploads) make a
// realistic image with Gemini. Each image is kept as an upload, so "Use in a video" sends it to the generator.
import { loadPricing, wireExamples } from "./models";
import { $, api, el, refreshWallet } from "./site";

type Ref = { id: string; thumb: string; label: string };
type Image = { id: string; at: string; prompt: string; ratio: string; references: number; costUsd: number; url: string };
type Product = { id: string; name: string; price: string | null; photos: { assetId: string; description: string | null }[] };

const RATIOS = ["1:1", "4:5", "3:4", "9:16", "16:9"];
const MAX_REFS = 3;
const state = { refs: [] as Ref[], ratio: "4:5", businessId: "", businesses: [] as { id: string; name: string }[], images: [] as Image[], current: null as Image | null };

const msg = (text: string, kind: "" | "err" | "ok" = "") => {
  const m = $("imgMsg");
  m.textContent = text;
  m.className = `msg left ${kind}`;
};

function renderRefs() {
  const strip = $("imgRefs");
  strip.replaceChildren(
    ...state.refs.map((r, i) => {
      const tile = el("div", { className: "ref on", title: `${r.label}. Click to remove.` }, el("img", { src: r.thumb }), el("b", { textContent: `Image ${i + 1}` }));
      tile.onclick = () => {
        state.refs.splice(i, 1);
        renderRefs();
      };
      return tile;
    }),
  );
  if (!state.refs.length) strip.append(el("span", { className: "muted small", textContent: "No reference: the image comes from the prompt alone." }));
  $("imgRefCount").textContent = `${state.refs.length}/${MAX_REFS}`;
  const full = state.refs.length >= MAX_REFS;
  $<HTMLButtonElement>("imgAddProduct").disabled = full;
  $<HTMLButtonElement>("imgUpload").disabled = full;
}

function addRef(r: Ref) {
  if (state.refs.length >= MAX_REFS) return msg(`At most ${MAX_REFS} reference photos.`, "err");
  if (state.refs.some((x) => x.id === r.id)) return;
  state.refs.push(r);
  renderRefs();
}

function renderRatios() {
  $("imgRatios").replaceChildren(
    ...RATIOS.map((r) => {
      const b = el("button", { className: `btn sm${r === state.ratio ? " on" : ""}`, textContent: r });
      b.onclick = () => {
        state.ratio = r;
        renderRatios();
      };
      return b;
    }),
  );
}

async function pickProduct() {
  const dlg = $("imgPick") as HTMLDialogElement;
  const sel = el("select", { style: "width:auto" });
  sel.append(...state.businesses.map((b) => new Option(b.name, b.id)));
  sel.value = state.businessId;
  $("imgPickTop").replaceChildren(sel);
  const grid = $("imgPickGrid");
  const show = async () => {
    state.businessId = sel.value;
    const products = await api<Product[]>(`/api/products?business=${encodeURIComponent(sel.value)}`);
    grid.replaceChildren();
    for (const p of products)
      for (const ph of p.photos) {
        const pk = el("div", { className: "pk" }, el("img", { src: `/api/photo/${ph.assetId}?size=thumb` }), el("span", { textContent: p.name }));
        pk.onclick = () => {
          addRef({ id: `ph:${ph.assetId}`, thumb: `/api/photo/${ph.assetId}?size=thumb`, label: `${p.name} photo` });
          dlg.close();
        };
        grid.append(pk);
      }
    if (!grid.childElementCount) grid.append(el("p", { className: "muted", textContent: "This business has no product photos." }));
  };
  sel.onchange = () => void show();
  dlg.showModal();
  await show();
}

async function upload(file: File) {
  msg("Uploading…");
  try {
    const out = await api<{ id: string }>("/api/upload", { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    addRef({ id: `up:${out.id}`, thumb: `/api/photo/${out.id}?size=thumb`, label: `Your photo: ${file.name}` });
    msg("Photo added.", "ok");
  } catch (e) {
    msg((e as Error).message, "err");
  }
}

function show(image: Image | null) {
  state.current = image;
  const stage = $("imgStage");
  $("imgActions").hidden = !image;
  if (!image) return;
  stage.replaceChildren(el("img", { src: image.url, alt: image.prompt }));
  $<HTMLAnchorElement>("imgUse").href = `/create?ref=${image.id}`;
  $<HTMLAnchorElement>("imgUseMotion").href = `/app/video/motion?ref=${image.id}`;
  const dl = $<HTMLAnchorElement>("imgDl");
  dl.href = image.url;
  dl.download = `bupulse-${image.id}.jpg`;
  $("imgInfo").textContent = `${image.prompt} · ${image.ratio} · ${image.references} reference${image.references === 1 ? "" : "s"} · ${new Date(image.at).toLocaleString()}`;
  renderGallery();
}

function renderGallery() {
  const grid = $("imgGallery");
  grid.replaceChildren(
    ...state.images.map((i) => {
      const card = el("button", { className: `imgCard${state.current?.id === i.id ? " on" : ""}`, title: i.prompt }, el("img", { src: `${i.url}?size=thumb`, loading: "lazy", alt: i.prompt }));
      card.onclick = () => {
        show(i);
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      return card;
    }),
  );
  if (!state.images.length) grid.append(el("p", { className: "muted", textContent: "No images yet. Your first one appears here." }));
}

async function generate() {
  const prompt = $<HTMLTextAreaElement>("imgPrompt").value.trim();
  if (!prompt) return msg("Describe the image first.", "err");
  const go = $<HTMLButtonElement>("imgGo");
  go.disabled = true;
  msg("Nano Banana is making your image… (10 to 30 seconds)");
  $("imgStage").replaceChildren(el("div", { className: "wait" }, el("span", { className: "spin" }), el("span", { className: "muted", textContent: "Making the image…" })));
  try {
    const out = await api<{ image: Image; credits: number }>("/api/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, refs: state.refs.map((r) => r.id), ratio: state.ratio, businessId: state.businessId }) });
    state.images.unshift(out.image);
    show(out.image);
    msg(`Done: ${out.credits} credits. Use it in a video or download it.`, "ok");
    await refreshWallet();
  } catch (e) {
    msg((e as Error).message, "err");
    show(state.current);
    if (!state.current) $("imgStage").replaceChildren(el("p", { className: "muted", textContent: "No image this time." }));
  } finally {
    go.disabled = false;
  }
}

async function start() {
  const q = new URLSearchParams(location.search);
  if (q.get("prompt")) $<HTMLTextAreaElement>("imgPrompt").value = (q.get("prompt") as string).slice(0, 1500);
  renderRatios();
  renderRefs();
  $("imgAddProduct").onclick = () => void pickProduct();
  $("imgUpload").onclick = () => $<HTMLInputElement>("imgFile").click();
  $<HTMLInputElement>("imgFile").onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void upload(f);
    (e.target as HTMLInputElement).value = "";
  };
  $("imgPickClose").onclick = () => ($("imgPick") as HTMLDialogElement).close();
  $("imgGo").onclick = () => void generate();
  wireExamples((text) => {
    $<HTMLTextAreaElement>("imgPrompt").value = text;
    window.scrollTo({ top: 0, behavior: "smooth" });
    msg("Example prompt added. Add your product photo as Image 1, then Generate.", "ok");
  });
  const [pricing, businesses, images] = await Promise.all([loadPricing(), api<{ id: string; name: string }[]>("/api/businesses"), api<{ images: Image[] }>("/api/images")]);
  $("imgCredits").textContent = `✦ ${pricing.presenterCredits}`;
  state.businesses = businesses;
  state.businessId = businesses[0]?.id ?? "";
  state.images = images.images;
  renderGallery();
  if (state.images[0]) show(state.images[0]);
}
void start().catch((e) => msg((e as Error).message, "err"));
