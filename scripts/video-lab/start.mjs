// Starts the BuPulse Video Studio (docs/VIDEO_ENGINE.md): bundles the server, the pages and their scripts with esbuild
// (the engine code in lib/video-engine is shared with the app), then runs the server on http://localhost:3100.
// Run: npm run lab   (reads .env; the database must be the TEST project)
// The build goes to video-lab/.build-next and replaces video-lab/.build only when every step worked. When a build fails
// (an agent mid-edit in a shared file), the error is printed and the last good build starts, so the studio stays up.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const live = path.join(root, "video-lab/.build");
const out = path.join(root, "video-lab/.build-next");
const site = path.join(root, "video-lab/site");

const TEST_PROJECT = "rzlcizxnhtfqminqkphp";
if (!(process.env.DATABASE_URL ?? "").includes(TEST_PROJECT)) {
  console.log("The Video Studio only runs against the TEST database. Check DATABASE_URL in .env.");
  process.exit(1);
}

/** Pages: fragment file -> title, nav key and scripts. */
const PAGES = {
  home: { title: "Real AI videos for your business", page: "home", scripts: ["home"] },
  create: { title: "Create", page: "video", scripts: ["create"] },
  showcase: { title: "Showcase", page: "showcase", scripts: ["showcase"] },
  videos: { title: "My videos", page: "videos", scripts: ["showcase"] },
  pricing: { title: "Pricing", page: "pricing", scripts: ["pricing"] },
  guide: { title: "Guide", page: "guide", scripts: [] },
  "api-docs": { title: "API for developers", page: "api", scripts: ["model"] },
  notfound: { title: "Not found", page: "", scripts: [] },
};

/** Models (video-lab/site/models.json): one generator page each, like seedance2ai's /app/video/<model>. */
const MODELS = JSON.parse(await fs.readFile(path.join(site, "models.json"), "utf8"));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const GROUP = { video: "AI video", motion: "3D motion", image: "AI image" };
const pill = (m) => `<span class="pill">${esc(m.name)} · ${GROUP[m.group]}${m.soon ? " · coming soon" : ""}</span>`;
const title1 = (m) => `<h1><b>${esc(m.name)}</b><span data-i18n="model.${m.id}.tagline">${esc(m.tagline)}</span></h1>`;
const others = (m) => MODELS.filter((x) => x.id !== m.id).map((x) => `<a href="${x.route}">${esc(x.name)}${x.soon ? " (soon)" : ""}</a>`).join("");
// Example prompts open this generator (or Seedance 2.0 for a model that is not here yet) with the prompt filled in.
const modelInfo = (m) => `<section class="section modelInfo">
  <div class="grid3">
    <div class="card hl"><p class="kicker">Model</p><h3>${esc(m.name)} <span class="tag${m.soon ? " soon" : ""}">${esc(m.tag)}</span></h3><p class="muted" data-i18n="model.${m.id}.blurb">${esc(m.blurb)}</p><p class="price"><b data-credits-for="${m.id}">…</b></p></div>
    <div class="card"><p class="kicker">Good at</p><ul>${m.goodAt.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></div>
    <div class="card otherModels"><p class="kicker">Other models</p>${others(m)}</div>
  </div>
  <h2 style="margin-top:34px">Example prompts</h2>
  <p class="muted">Click one to put it in the prompt box, then change it for your product.</p>
  <div class="examples">${m.examples.map((e) => `<button class="example" data-example="${esc(e)}" data-target="${m.soon ? "/app/video/seedance-2-0" : m.route}"><span>${esc(e)}</span><small>Use this prompt →</small></button>`).join("")}</div>
</section>`;
const modelCard = (m) => `<a class="mcard${m.soon ? " soon" : ""}" href="${m.route}"><span class="tag${m.soon ? " soon" : ""}">${esc(m.tag)}</span><h3>${esc(m.name)}</h3><p class="muted" data-i18n="model.${m.id}.blurb">${esc(m.blurb)}</p><p class="price" data-credits-for="${m.id}">…</p><span class="go" data-i18n="${m.soon ? "home.models.soon" : "home.models.open"}">${m.soon ? "Coming soon: see what it will do" : "Open the generator →"}</span></a>`;
const modelCards = [
  ["video", "AI video", "home.models.video"],
  ["image", "AI image", "home.models.image"],
  ["motion", "Claude 3D motion", "home.models.motion"],
]
  .map(([g, label, key]) => `<div class="modelGroup"><h3 data-i18n="${key}">${label}</h3><div class="mgrid">${MODELS.filter((m) => m.group === g).map(modelCard).join("")}</div></div>`)
  .join("");
const CREATE_HEAD = {
  pill: `<span class="pill" data-i18n="create.pill">BuPulse Video Studio</span>`,
  title1: `<h1><b data-i18n="create.h1a">Turn any product</b><span data-i18n="create.h1b">into ready to post video</span></h1>`,
};

/** The whole build, into video-lab/.build-next. Throws on the first failure. */
async function buildAll() {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, "pages"), { recursive: true });
  await fs.mkdir(path.join(out, "js"), { recursive: true });
  const common = { absWorkingDir: root, tsconfig: "tsconfig.json", bundle: true, logLevel: "warning", legalComments: "none" };
  await build({ ...common, entryPoints: ["video-lab/server.ts"], outfile: path.join(out, "server.mjs"), platform: "node", format: "esm", target: "node22", packages: "external" });
  await build({
    ...common,
    entryPoints: { site: "video-lab/site/client/site.ts", home: "video-lab/site/client/home.ts", create: "video-lab/site/client/create.ts", showcase: "video-lab/site/client/showcase.ts", pricing: "video-lab/site/client/pricing.ts", image: "video-lab/site/client/image.ts", model: "video-lab/site/client/model.ts", lab: "video-lab/client/app.ts" },
    outdir: path.join(out, "js"),
    platform: "browser",
    format: "iife",
    target: "chrome120",
    minify: false,
    sourcemap: "inline",
  });
  const layout = await fs.readFile(path.join(site, "layout.html"), "utf8");
  const fragment = async (name) => fs.readFile(path.join(site, "pages", `${name}.html`), "utf8");
  const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in values ? values[k] : all));
  const page = (content, p) => fill(layout, { title: esc(p.title), page: p.page, model: p.model ?? "", content, scripts: p.scripts.map((s) => `<script src="/js/${s}.js"></script>`).join("\n") });
  for (const [name, p] of Object.entries(PAGES)) {
    const content = fill(await fragment(name), { ...CREATE_HEAD, modelInfo: "", modelCards });
    await fs.writeFile(path.join(out, "pages", `${name}.html`), page(content, p));
  }
  for (const m of MODELS) {
    const values = { pill: pill(m), title1: title1(m), modelInfo: modelInfo(m) };
    const [name, frag, scripts] = m.group === "image" ? [`image`, "image", ["image"]] : m.soon ? [`model-${m.id}`, "soon", ["model"]] : [`model-${m.id}`, "create", ["create"]];
    const p = { title: `${m.name}: ${m.tagline}`, page: m.group === "image" ? "image" : "video", model: m.id, scripts };
    await fs.writeFile(path.join(out, "pages", `${name}.html`), page(fill(await fragment(frag), values), p));
  }
  await fs.copyFile(path.join(site, "site.css"), path.join(out, "site.css"));
  await fs.cp(path.join(site, "static"), path.join(out, "static"), { recursive: true }).catch(() => undefined);
  await fs.copyFile(path.join(root, "video-lab/client/index.html"), path.join(out, "lab.html"));
}

const exists = (p) => fs.access(p).then(() => true, () => false);
try {
  await buildAll();
  // Swap in the new build only now that every step has worked.
  await fs.rm(`${live}-old`, { recursive: true, force: true });
  if (await exists(live)) await fs.rename(live, `${live}-old`);
  await fs.rename(out, live);
  await fs.rm(`${live}-old`, { recursive: true, force: true });
} catch (error) {
  console.log(`[lab] The build failed: ${error instanceof Error ? error.message : error}`);
  if (!(await exists(path.join(live, "server.mjs")))) {
    console.log("[lab] There is no earlier build to start. Fix the error above and run npm run lab again.");
    process.exit(1);
  }
  console.log("[lab] Starting the last good build instead (the change above is not in it yet).");
}
await import(pathToFileURL(path.join(live, "server.mjs")).href);
