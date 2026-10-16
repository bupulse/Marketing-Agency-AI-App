// Starts the BuPulse Video Lab (docs/VIDEO_ENGINE.md): bundles the lab server and page with esbuild (the engine code in
// lib/video-engine is shared with the app), then runs the server on http://localhost:3100.
// Run: npm run lab   (reads .env; the database must be the TEST project)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const out = path.join(root, "video-lab/.build");

const TEST_PROJECT = "rzlcizxnhtfqminqkphp";
if (!(process.env.DATABASE_URL ?? "").includes(TEST_PROJECT)) {
  console.log("The Video Lab only runs against the TEST database. Check DATABASE_URL in .env.");
  process.exit(1);
}

await fs.mkdir(out, { recursive: true });
const common = { absWorkingDir: root, tsconfig: "tsconfig.json", bundle: true, logLevel: "warning", legalComments: "none" };
await build({
  ...common,
  entryPoints: ["video-lab/server.ts"],
  outfile: path.join(out, "server.mjs"),
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});
await build({
  ...common,
  entryPoints: ["video-lab/client/app.ts"],
  outfile: path.join(out, "app.js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
  minify: false,
  sourcemap: "inline",
});
await fs.copyFile(path.join(root, "video-lab/client/index.html"), path.join(out, "index.html"));
await import(pathToFileURL(path.join(out, "server.mjs")).href);
