// Seedance "Get inspired" examples (docs/VIDEO_ENGINE.md, "Example storyboards"): free storyboards made from the TEST
// database's real products with the Seedance brain, no key and no Claude. Saved in video-lab/seedance-mock/examples/.
// Run: node --env-file=.env scripts/video-lab/seedance-examples.mjs           (writes the examples)
//      node --env-file=.env scripts/video-lab/seedance-examples.mjs --list    (lists the products and their sectors)
//      ... --skip "LEAF"   (leaves out businesses whose name contains the text; repeat for more)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
if (!(process.env.DATABASE_URL ?? "").includes("rzlcizxnhtfqminqkphp")) {
  console.log("The examples are only made from the TEST database. Check DATABASE_URL in .env.");
  process.exit(1);
}

// The engine is TypeScript: bundle it next to node_modules (in the git-ignored data folder), load it, remove it.
const bundled = path.join(root, "video-lab/data/.seedance-examples-bundle.mjs");
await fs.mkdir(path.dirname(bundled), { recursive: true });
await build({
  entryPoints: ["video-lab/seedance-mock/examples.ts"],
  outfile: bundled,
  absWorkingDir: root,
  tsconfig: "tsconfig.json",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});
const ex = await import(pathToFileURL(bundled).href);
await fs.rm(bundled, { force: true });

try {
  if (process.argv.includes("--list")) {
    for (const c of await ex.loadCandidates()) console.log(`${c.kind.padEnd(12)} ${c.business.name} / ${c.product.name} | ${c.product.price ?? "no price"} | ${c.product.photos.length} photos | ${c.business.language}`);
  } else {
    const skip = process.argv.flatMap((a, i) => (a === "--skip" && process.argv[i + 1] ? [process.argv[i + 1]] : []));
    const written = await ex.writeSeedanceExamples(16, skip);
    for (const e of written) console.log(`${e.id}: ${e.sector} / ${e.format} - ${e.source.businessName}, ${e.source.productName}`);
    console.log(`\n${written.length} examples saved in video-lab/seedance-mock/examples/.`);
  }
} finally {
  await ex.closeDb();
}
