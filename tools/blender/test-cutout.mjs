// Makes the test cutout used by tools/blender/scenes/poster-plinth.json (docs/BLENDER.md): the phone from a cached
// lab photo, cut out along a hand-measured outline (no background-removal model yet). Test data only, git-ignored.
//   node tools/blender/test-cutout.mjs
import fs from "node:fs/promises";
import sharp from "sharp";

const SRC = "video-lab/data/photos/1160bafd-8ab9-45fe-83f3-51e27338f29d-1280.jpg";
const OUT = "video-lab/data/blender/test/phone-cutout.png";
// The phone's corners in the 1024 x 1024 photo, measured by eye; the round stroke gives the rounded corners.
const BOX = { left: 330, top: 170, width: 400, height: 740 };
const POINTS = "50,40 283,77 350,640 103,703";

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX.width}" height="${BOX.height}">` +
    `<polygon points="${POINTS}" fill="#fff" stroke="#fff" stroke-width="44" stroke-linejoin="round"/></svg>`,
);
await fs.mkdir("video-lab/data/blender/test", { recursive: true });
await sharp(SRC)
  .extract(BOX)
  .ensureAlpha()
  .composite([{ input: await sharp(mask).blur(1.2).toBuffer(), blend: "dest-in" }])
  .png()
  .toFile(OUT);
console.log(`Cutout: ${OUT}`);
