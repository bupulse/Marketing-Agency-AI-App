// Bundles the video robot's page (page-entry.ts with the browser renderer) into one script with esbuild, in memory.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function buildPage() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["scripts/video-robot/page-entry.ts"],
    tsconfig: "tsconfig.json",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    minify: true,
    write: false,
    logLevel: "silent",
    legalComments: "none",
  });
  const script = result.outputFiles[0].text;
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Video robot</title></head><body><script src="/robot.js"></script></body></html>';
  return { html, script };
}
