// Builds the web version of the BuPulse guide from docs/guide/**/*.md: one HTML page (sidebar, search, screenshots,
// playable clips) plus the images and videos next to it, ready to publish.
//
//   node scripts/docs/build-guide-page.mjs <out dir>
//
// The Markdown stays the source of truth; this only packages it. Pages are rendered in the browser with marked
// (pinned from cdnjs). Links between guide pages become in-page routes (#install-01-run-on-a-new-computer).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GUIDE = path.join(ROOT, "docs/guide");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, ".guide-page"));

// Sidebar order: [section, [file, ...]]. Files that do not exist yet are skipped.
const listDir = (dir) => (fs.existsSync(path.join(GUIDE, dir)) ? fs.readdirSync(path.join(GUIDE, dir)).filter((f) => f.endsWith(".md")).sort().map((f) => `${dir}/${f}`) : []);
const SECTIONS = [
  ["Start", ["README.md"]],
  ["Install", listDir("install")],
  ["Client features", ["features/README.md", ...listDir("features").filter((f) => !f.endsWith("README.md"))]],
  ["Admin console", ["admin/README.md", ...listDir("admin").filter((f) => !f.endsWith("README.md"))]],
  ["Code", ["code-map.md", "troubleshooting.md"]],
];

const idOf = (file) => (file === "README.md" ? "start" : file.replace(/\.md$/, "").replace(/\/README$/, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase());

const pages = [];
for (const [section, files] of SECTIONS) {
  for (const file of files) {
    const abs = path.join(GUIDE, file);
    if (!fs.existsSync(abs)) continue;
    const md = fs.readFileSync(abs, "utf8");
    const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? file).trim();
    pages.push({ id: idOf(file), file, section, title, md });
  }
}
const ids = new Map(pages.map((p) => [p.file, p.id]));

// Demo videos (git-ignored, on the owner's Mac): the short landscape versions are copied next to the page.
const DEMOS = [
  ["1-intro", "Demo/Social media/1 Intro (landscape 16x9).mp4"],
  ["2-starter-inzu", "Demo/Social media/2 Starter plan - Inzu Fashion (landscape 16x9).mp4"],
  ["3-business-urugo", "Demo/Social media/3 Business plan - Urugo Homes (landscape 16x9).mp4"],
  ["4-custom-nova", "Demo/Social media/4 Custom plan - Nova Phones Kigali (landscape 16x9).mp4"],
  ["5-paying-by-card", "Demo/Social media/5 Paying by card (landscape 16x9).mp4"],
].filter(([, f]) => fs.existsSync(path.join(ROOT, f)));

/** Rewrites one page's links and media paths for the single-page site. */
function rewrite(page) {
  const dir = path.posix.dirname(page.file);
  const resolve = (target) => path.posix.normalize(path.posix.join(dir, target));
  return page.md.replace(/(\]\(|src=")([^)"\s]+)/g, (all, lead, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return all;
    // Code files (app/..., lib/...): shown as their repository path, since the page cannot open them.
    if (!/\.(md|jpg|png|webm|mp4)(#|$)/.test(target)) return `${lead}repo:${path.posix.normalize(path.posix.join("docs/guide", dir, target.split("#")[0]))}`;
    const [file, anchor] = target.split("#");
    const rel = resolve(file);
    if (/^(images|videos)\//.test(rel)) return `${lead}${rel}`;
    if (rel.endsWith(".md")) {
      const id = ids.get(rel);
      if (id) return `${lead}#${id}${anchor ? `~${anchor}` : ""}`;
      // A doc outside the guide (docs/BILLING.md): show its path in the repository.
      return `${lead}repo:${path.posix.normalize(path.posix.join("docs/guide", rel))}`;
    }
    return all;
  });
}

const data = {
  pages: pages.map((p) => ({ id: p.id, section: p.section, title: p.title, file: `docs/guide/${p.file}`, md: rewrite(p) })),
  demos: DEMOS.map(([id, f]) => ({ id, title: path.basename(f, ".mp4").replace(" (landscape 16x9)", ""), src: `demo/${id}.mp4`, path: f })),
  builtAt: new Date().toISOString().slice(0, 10),
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const sub of ["images", "videos"]) if (fs.existsSync(path.join(GUIDE, sub))) fs.cpSync(path.join(GUIDE, sub), path.join(OUT, sub), { recursive: true, filter: (s) => !s.endsWith("manifest.json") });
fs.mkdirSync(path.join(OUT, "demo"), { recursive: true });
for (const [id, f] of DEMOS) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, "demo", `${id}.mp4`));

const template = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "guide-page.html"), "utf8");
const json = JSON.stringify(data).replace(/</g, "\\u003c");
fs.writeFileSync(path.join(OUT, "index.html"), template.replace("/*GUIDE_DATA*/null", json));

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name !== "index.html") files.push(path.relative(OUT, p)); } };
walk(OUT);
fs.writeFileSync(path.join(OUT, "files.json"), JSON.stringify(files, null, 2));
console.log(`${pages.length} pages, ${files.length} files -> ${OUT}`);
