// The Viral library (/viral): browse the viral videos the research team saved (docs/research/viral, served by
// video-lab/viral.ts), filter them, open one in a drawer with its breakdown, and start a video like it in /create.
import { $, api, el } from "./site";
import { T, currentLang } from "./i18n";

type Beat = { from?: number; to?: number; beat?: string; what?: string };
type Row = {
  id: string; platform: "tiktok" | "instagram" | "facebook" | "youtube"; framesAvailable: string[];
  url?: string; embed_url?: string | null; account?: string; account_name?: string; followers?: number | null; country?: string | null; city?: string | null;
  sector?: string; kind?: string; is_ad?: boolean; posted?: string | null; captured_at?: string; duration_s?: number | null;
  views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null;
  viral_ratio?: number | null; viral_basis?: string; caption?: string; hashtags?: string[]; sound?: { name?: string; original?: boolean; kind?: string } | null;
  hook_text?: string; hook_type?: string; first_3s?: string; structure?: Beat[]; cuts_per_10s?: number | null; text_style?: string; voice?: string; cta?: string;
  format?: string; why_viral?: string; lesson_for_engine?: string; top_comments?: { text?: string; likes?: number | null }[];
};
type Library = { rows: Row[]; counts: Record<string, Record<string, number>> };

const PLATFORMS = ["tiktok", "instagram", "facebook", "youtube"] as const;
const PLATFORM_NAME: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };
const EAST_AFRICA = ["RW", "KE", "UG", "TZ", "BI", "CD", "ET", "SS", "SO"];
const EMBED_HOSTS = ["tiktok.com", "instagram.com", "facebook.com", "youtube.com"];

/** A label in the chosen language: the dictionary in i18n.ts, else the English given here. */
const tr = (key: string, en: string) => {
  const lang = currentLang();
  return lang === "en" ? en : (T[key]?.[lang] ?? en);
};
const num = (n: number | null | undefined) => (n == null ? "" : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));
const flag = (c?: string | null) => (c && /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "");
const frameUrl = (r: Row, file: string) => `/viral/frames/${r.platform}/${r.id}/${file}`;
const safeLink = (u?: string | null, hosts?: string[]) => {
  try {
    const x = new URL(u ?? "");
    const ok = x.protocol === "https:" && (!hosts || hosts.some((h) => x.hostname === h || x.hostname.endsWith(`.${h}`)));
    return ok ? x.href : null;
  } catch {
    return null;
  }
};
const viewsLine = (r: Row) => {
  const bits = [r.views != null ? `${num(r.views)} ${tr("viral.views", "views")}` : r.likes != null ? `${num(r.likes)} ${tr("viral.likes", "likes")}` : r.is_ad ? "Ad" : ""];
  if (r.viral_ratio != null && r.followers) bits.push(`${num(r.viral_ratio)}× ${tr("viral.followers", "followers")}`);
  return bits.filter(Boolean).join(" · ");
};

let data: Library = { rows: [], counts: {} };
let lastJson = "";
const f = { platform: "all", region: "all", sector: "", format: "", hook: "", ads: false, q: "", sort: "views" };

const sel = (id: string) => $<HTMLSelectElement>(id);

function fillSelect(id: string, first: string, field: string, current: string) {
  const s = sel(id);
  const entries = Object.entries(data.counts[field] ?? {}).sort((a, b) => b[1] - a[1]);
  s.replaceChildren(el("option", { value: "", textContent: first }), ...entries.map(([k, n]) => el("option", { value: k, textContent: `${k} (${n})` })));
  s.value = entries.some(([k]) => k === current) ? current : "";
}

function fillStatic() {
  const regions: [string, string, string][] = [["all", "viral.r.all", "All regions"], ["east", "viral.r.east", "East Africa"], ["rw", "viral.r.rw", "Rwanda only"], ["global", "viral.r.global", "Global"]];
  sel("vRegion").replaceChildren(...regions.map(([v, k, en]) => el("option", { value: v, textContent: tr(k, en) })));
  sel("vRegion").value = f.region;
  const sorts: [string, string, string][] = [["views", "viral.s.views", "Sort: views"], ["ratio", "viral.s.ratio", "Sort: viral ratio"], ["likes", "viral.s.likes", "Sort: likes"], ["new", "viral.s.new", "Sort: newest"]];
  sel("vSort").replaceChildren(...sorts.map(([v, k, en]) => el("option", { value: v, textContent: tr(k, en) })));
  sel("vSort").value = f.sort;
  const tabs = $("vTabs");
  tabs.replaceChildren(
    ...(["all", ...PLATFORMS] as const).map((p) => {
      const n = p === "all" ? data.rows.length : (data.counts.platform?.[p] ?? 0);
      const b = el("button", { className: `btn sm${f.platform === p ? " on" : ""}`, textContent: `${p === "all" ? tr("viral.all", "All") : tr(`viral.p.${p}`, PLATFORM_NAME[p])} (${n})` });
      b.onclick = () => {
        f.platform = p;
        fillStatic();
        render();
      };
      return b;
    }),
  );
  fillSelect("vSector", tr("viral.f.sector", "All sectors"), "sector", f.sector);
  fillSelect("vFormat", tr("viral.f.format", "All formats"), "format", f.format);
  fillSelect("vHook", tr("viral.f.hook", "All hook types"), "hook_type", f.hook);
}

function header() {
  const rows = data.rows;
  $("vTotals").textContent = rows.length ? `${rows.length} ${tr("viral.totals", "viral videos from TikTok, Instagram, Facebook and YouTube Shorts")}` : "";
  const newest = rows.map((r) => r.captured_at ?? "").sort().pop();
  $("vNewest").textContent = newest ? `${tr("viral.newest", "Newest capture:")} ${newest.slice(0, 10)}` : "";
}

function matches(r: Row) {
  if (f.platform !== "all" && r.platform !== f.platform) return false;
  const east = !!r.country && EAST_AFRICA.includes(r.country);
  if (f.region === "east" && !east) return false;
  if (f.region === "rw" && r.country !== "RW") return false;
  if (f.region === "global" && east) return false;
  if (f.sector && r.sector !== f.sector) return false;
  if (f.format && r.format !== f.format) return false;
  if (f.hook && r.hook_type !== f.hook) return false;
  if (f.ads && !r.is_ad) return false;
  if (f.q) {
    const hay = `${r.caption ?? ""} ${r.account ?? ""} ${r.account_name ?? ""} ${(r.hashtags ?? []).join(" ")}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const sortKey: Record<string, (r: Row) => number | string> = {
  views: (r) => r.views ?? -1,
  ratio: (r) => r.viral_ratio ?? -1,
  likes: (r) => r.likes ?? -1,
  new: (r) => r.posted ?? "",
};

function card(r: Row) {
  const b = el("button", { className: "vCard", type: "button" });
  const first = r.framesAvailable[0];
  if (first) {
    const img = el("img", { src: frameUrl(r, first), alt: r.hook_text ?? r.account ?? r.id, loading: "lazy" });
    let timer = 0;
    let i = 0;
    b.onmouseenter = () => {
      if (r.framesAvailable.length < 2) return;
      timer = window.setInterval(() => {
        i = (i + 1) % r.framesAvailable.length;
        img.src = frameUrl(r, r.framesAvailable[i]);
      }, 700);
    };
    b.onmouseleave = () => {
      clearInterval(timer);
      i = 0;
      img.src = frameUrl(r, first);
    };
    b.append(img);
  } else b.append(el("div", { className: "vNoFrame", textContent: tr("viral.noframes", "No frames saved") }));
  b.append(
    el("span", { className: `vPlat ${r.platform}`, textContent: PLATFORM_NAME[r.platform] }),
    el("span", { className: "vFlag", textContent: r.country ? `${flag(r.country)} ${r.country}` : "🌍" }),
    el("div", { className: "vCap" }, el("span", { className: "vNum", textContent: viewsLine(r) }), el("span", { className: "vAcct", textContent: r.account ?? "" }), el("span", { className: "vHook", textContent: r.hook_text ?? "" })),
  );
  b.onclick = () => openDrawer(r);
  return b;
}

function render() {
  const list = data.rows.filter(matches).sort((a, b) => {
    const k = sortKey[f.sort];
    const x = k(a);
    const y = k(b);
    return x < y ? 1 : x > y ? -1 : 0;
  });
  $("vGrid").replaceChildren(...list.map(card));
  $("vEmpty").hidden = data.rows.length > 0;
  $("vNone").hidden = !data.rows.length || list.length > 0;
  $("vCount").textContent = data.rows.length ? `${list.length} ${tr("viral.shown", "videos shown")}` : "";
}

// ---- The drawer -------------------------------------------------------------------------------------------------

let current: Row | null = null;

function block(title: string, ...body: (Node | string)[]) {
  return el("div", { className: "vBlock" }, el("h5", { textContent: title }), ...body);
}

function timeline(beats: Beat[]) {
  const total = Math.max(1, ...beats.map((b) => b.to ?? 0));
  const bar = el("div", { className: "vTimeline" });
  for (const b of beats) bar.append(el("span", { style: `flex:${Math.max(1, (b.to ?? 0) - (b.from ?? 0))} 1 0`, title: b.what ?? "", textContent: b.beat ?? "" }));
  const list = el("div", { className: "vBeats" }, ...beats.map((b) => el("span", {}, el("b", { textContent: `${b.from ?? "?"}–${b.to ?? "?"} s ${b.beat ?? ""}: ` }), b.what ?? "")));
  return el("div", {}, bar, list, el("span", { className: "hint", textContent: `${total} s` }));
}

/** The /create link with the note filled in from the row: format, hook and structure in a sentence or two. */
export function makeLikeThisNote(r: Row): string {
  const steps = (r.structure ?? []).map((b) => `${b.beat ?? "beat"} ${b.from ?? "?"}-${b.to ?? "?"} s: ${b.what ?? ""}`).join("; ");
  const parts = [
    `Make a ${r.format ?? "short"} video like a viral ${PLATFORM_NAME[r.platform]} one for my product.`,
    r.hook_text ? `Hook${r.hook_type ? ` (${r.hook_type})` : ""}: "${r.hook_text}".` : "",
    steps ? `Structure: ${steps}.` : "",
    r.lesson_for_engine ? `Lesson: ${r.lesson_for_engine}` : "",
  ];
  return parts.filter(Boolean).join(" ").slice(0, 1500);
}

function showFrame(r: Row, file: string) {
  $("vdPhone").replaceChildren(el("img", { src: frameUrl(r, file), alt: "" }));
  $("vdStrip").querySelectorAll("img").forEach((i) => i.classList.toggle("on", i.dataset.file === file));
}

function openDrawer(r: Row) {
  current = r;
  const name = PLATFORM_NAME[r.platform];
  $("vdTitle").textContent = `${name} · ${r.account ?? r.id}`;
  const link = safeLink(r.url);
  const open = $<HTMLAnchorElement>("vdOpen");
  open.hidden = !link;
  if (link) open.href = link;
  open.textContent = `${tr("viral.openon", "Open on")} ${name}`;
  $("vdPhone").replaceChildren(r.framesAvailable.length ? el("img", { src: frameUrl(r, r.framesAvailable[0]), alt: "" }) : el("div", { className: "vNoFrame", style: "height:100%;display:flex;align-items:center;justify-content:center;color:#a1a1a6", textContent: tr("viral.noframes", "No frames saved") }));
  $("vdStrip").replaceChildren(
    ...r.framesAvailable.map((file, i) => {
      const img = el("img", { src: frameUrl(r, file), alt: "", className: i === 0 ? "on" : "" });
      img.dataset.file = file;
      img.onclick = () => showFrame(r, file);
      return img;
    }),
  );
  const embed = safeLink(r.embed_url, EMBED_HOSTS);
  const play = $<HTMLButtonElement>("vdPlay");
  play.hidden = !embed;
  play.textContent = `▶ ${tr("viral.play", "Play on")} ${name}`;
  // The official player loads only now, when asked: nothing from the network sites loads while browsing.
  play.onclick = () => {
    if (!embed) return;
    $("vdPhone").replaceChildren(el("iframe", { src: embed, allow: "autoplay; encrypted-media; fullscreen; picture-in-picture", allowFullscreen: true, referrerPolicy: "strict-origin-when-cross-origin", title: name }));
    play.hidden = true;
  };

  const side = $("vdSide");
  const nums: [string, number | null | undefined][] = [["viral.views", r.views], ["viral.likes", r.likes], ["viral.comments", r.comments], ["viral.shares", r.shares], ["viral.saves", r.saves], ["viral.followers", r.followers]];
  const kv = el("div", { className: "kv" });
  for (const [k, v] of nums) if (v != null) kv.append(el("span", { className: "k", textContent: tr(k, k.slice(6)) }), el("span", { textContent: v.toLocaleString() }));
  if (r.viral_ratio != null) kv.append(el("span", { className: "k", textContent: "Viral ratio" }), el("span", { textContent: `${num(r.viral_ratio)}×${r.viral_basis ? ` (${r.viral_basis})` : ""}` }));
  for (const [k, v] of [["Country", [flag(r.country), r.country, r.city].filter(Boolean).join(" ")], ["Sector", r.sector], ["Format", r.format], ["Hook type", r.hook_type], ["Posted", r.posted], ["Length", r.duration_s ? `${r.duration_s} s` : ""], ["Type", r.is_ad ? "Ad" : r.kind]] as [string, string | null | undefined][])
    if (v) kv.append(el("span", { className: "k", textContent: k }), el("span", { textContent: v }));

  const caption = el("div", { className: "vCaption", textContent: r.caption ?? "" });
  const copy = el("button", { className: "btn sm", type: "button", textContent: tr("viral.copy", "Copy") });
  copy.onclick = () => {
    void navigator.clipboard?.writeText(r.caption ?? "").then(() => {
      copy.textContent = tr("viral.copied", "Copied");
      setTimeout(() => (copy.textContent = tr("viral.copy", "Copy")), 1500);
    });
  };
  const text = (label: string, v?: string | null): HTMLDivElement | null => (v ? block(label, el("p", { textContent: v })) : null);
  const parts: (Node | null)[] = [
    el("h3", { style: "margin:0;font-size:15px", textContent: r.hook_text || r.account_name || r.id }),
    kv,
    r.caption ? block(tr("viral.caption", "Caption (verbatim)"), caption, el("div", { style: "margin-top:6px" }, copy)) : null,
    r.hashtags?.length ? block(tr("viral.hashtags", "Hashtags"), el("div", { className: "vTags" }, ...r.hashtags.map((h) => el("span", { className: "chip", textContent: `#${h}` })))) : null,
    r.sound?.name ? block(tr("viral.sound", "Sound"), el("p", { textContent: `${r.sound.name}${r.sound.original ? " (original)" : ""}` })) : null,
    block(tr("viral.breakdown", "Breakdown"), ...[text(tr("viral.first3", "First 3 seconds"), r.first_3s), r.structure?.length ? block(tr("viral.structure", "Structure"), timeline(r.structure)) : null, text(tr("viral.cuts", "Cuts per 10 s"), r.cuts_per_10s == null ? null : String(r.cuts_per_10s)), text(tr("viral.textstyle", "Text style"), r.text_style), text(tr("viral.voice", "Voice"), r.voice), text(tr("viral.cta", "Call to action"), r.cta)].filter((x): x is HTMLDivElement => !!x)),
    text(tr("viral.why", "Why it went viral"), r.why_viral),
    text(tr("viral.lesson", "Lesson for BuPulse"), r.lesson_for_engine),
    r.top_comments?.length ? block(tr("viral.comm", "Top comments"), el("ul", {}, ...r.top_comments.map((c) => el("li", { textContent: `${c.text ?? ""}${c.likes != null ? `  (${num(c.likes)} ♥)` : ""}` })))) : null,
  ];
  const make = el("a", { className: "btn primary vMakeBtn", href: `/create?${new URLSearchParams({ prompt: makeLikeThisNote(r) })}`, textContent: tr("viral.make", "Make a video like this") });
  side.replaceChildren(...parts.filter((x): x is Node => !!x), make);
  $("vDrawer").classList.add("open");
  $("vDrawer").setAttribute("aria-hidden", "false");
  history.replaceState(null, "", `#${r.id}`);
}

function closeDrawer() {
  $("vDrawer").classList.remove("open");
  $("vDrawer").setAttribute("aria-hidden", "true");
  $("vdPhone").replaceChildren(); // stops a playing embed
  current = null;
  history.replaceState(null, "", location.pathname);
}

// ---- Loading and wiring -----------------------------------------------------------------------------------------

let first = true;
async function load() {
  try {
    const lib = await api<Library>("/api/viral");
    const json = JSON.stringify(lib);
    if (json === lastJson) return;
    lastJson = json;
    data = lib;
  } catch {
    return;
  }
  header();
  fillStatic();
  render();
  if (first) {
    first = false;
    const wanted = data.rows.find((r) => r.id === location.hash.slice(1));
    if (wanted) openDrawer(wanted);
  }
}

const bind = (id: string, key: "region" | "sector" | "format" | "hook" | "sort") => (sel(id).onchange = () => ((f[key] = sel(id).value), render()));
bind("vRegion", "region");
bind("vSector", "sector");
bind("vFormat", "format");
bind("vHook", "hook");
bind("vSort", "sort");
$<HTMLInputElement>("vAds").onchange = () => ((f.ads = $<HTMLInputElement>("vAds").checked), render());
$<HTMLInputElement>("vSearch").oninput = () => ((f.q = $<HTMLInputElement>("vSearch").value.trim()), render());
$("vdClose").onclick = closeDrawer;
document.addEventListener("keydown", (e) => e.key === "Escape" && current && closeDrawer());
window.addEventListener("studio:lang", () => {
  header();
  fillStatic();
  render();
  if (current) openDrawer(current);
});
fillStatic();
void load();
setInterval(() => void load(), 60_000);
