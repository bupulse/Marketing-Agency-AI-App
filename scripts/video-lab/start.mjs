// Starts the BuPulse Video Studio (docs/VIDEO_ENGINE.md): bundles the server, the pages and their scripts with esbuild
// (the engine code in lib/video-engine is shared with the app), then runs the server on http://localhost:3100.
// Run: npm run lab   (reads .env; the database must be the TEST project)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const out = path.join(root, "video-lab/.build");
const site = path.join(root, "video-lab/site");

const TEST_PROJECT = "rzlcizxnhtfqminqkphp";
if (!(process.env.DATABASE_URL ?? "").includes(TEST_PROJECT)) {
  console.log("The Video Studio only runs against the TEST database. Check DATABASE_URL in .env.");
  process.exit(1);
}

/** Pages: fragment file -> title, nav key and scripts. */
const PAGES = {
  home: { title: "Real AI videos for your business", page: "home", scripts: ["home"] },
  create: { title: "Create", page: "seedance", scripts: ["create"] },
  showcase: { title: "Showcase", page: "showcase", scripts: ["showcase"] },
  videos: { title: "My videos", page: "videos", scripts: ["showcase"] },
  pricing: { title: "Pricing", page: "pricing", scripts: ["pricing"] },
  guide: { title: "Guide", page: "guide", scripts: [] },
};

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "pages"), { recursive: true });
await fs.mkdir(path.join(out, "js"), { recursive: true });
const common = { absWorkingDir: root, tsconfig: "tsconfig.json", bundle: true, logLevel: "warning", legalComments: "none" };
await build({ ...common, entryPoints: ["video-lab/server.ts"], outfile: path.join(out, "server.mjs"), platform: "node", format: "esm", target: "node22", packages: "external" });
await build({
  ...common,
  entryPoints: { site: "video-lab/site/client/site.ts", home: "video-lab/site/client/home.ts", create: "video-lab/site/client/create.ts", showcase: "video-lab/site/client/showcase.ts", pricing: "video-lab/site/client/pricing.ts", lab: "video-lab/client/app.ts" },
  outdir: path.join(out, "js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
  minify: false,
  sourcemap: "inline",
});
const layout = await fs.readFile(path.join(site, "layout.html"), "utf8");
for (const [name, p] of Object.entries(PAGES)) {
  const content = await fs.readFile(path.join(site, "pages", `${name}.html`), "utf8");
  const html = layout.replace("{{title}}", p.title).replace("{{page}}", p.page).replace("{{content}}", content).replace("{{scripts}}", p.scripts.map((s) => `<script src="/js/${s}.js"></script>`).join("\n"));
  await fs.writeFile(path.join(out, "pages", `${name}.html`), html);
}
await fs.copyFile(path.join(site, "site.css"), path.join(out, "site.css"));
await fs.copyFile(path.join(root, "video-lab/client/index.html"), path.join(out, "lab.html"));
await import(pathToFileURL(path.join(out, "server.mjs")).href);
