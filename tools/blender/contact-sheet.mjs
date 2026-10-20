// Contact sheet for checking Blender renders by eye (docs/BLENDER.md): puts PNG stills side by side, one row per
// group, and writes a JPEG.
//   node tools/blender/contact-sheet.mjs out.jpg --width 270 a1.png a2.png a3.png -- b1.png b2.png b3.png
import sharp from "sharp";

const args = process.argv.slice(2);
const out = args.shift();
let width = 270;
const rows = [[]];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--width") width = Number(args[++i]);
  else if (args[i] === "--") rows.push([]);
  else rows[rows.length - 1].push(args[i]);
}
if (!out || !rows[0].length) {
  console.error("Usage: node tools/blender/contact-sheet.mjs out.jpg [--width 270] a.png b.png [-- c.png d.png]");
  process.exit(1);
}

const GAP = 8;
const tiles = [];
let top = GAP;
let sheetWidth = 0;
for (const row of rows.filter((r) => r.length)) {
  let left = GAP;
  let rowHeight = 0;
  for (const file of row) {
    const input = await sharp(file).resize(width).toBuffer();
    const { height } = await sharp(input).metadata();
    tiles.push({ input, left, top });
    left += width + GAP;
    rowHeight = Math.max(rowHeight, height ?? 0);
  }
  sheetWidth = Math.max(sheetWidth, left);
  top += rowHeight + GAP;
}
await sharp({ create: { width: sheetWidth, height: top, channels: 3, background: "#ffffff" } })
  .composite(tiles)
  .jpeg({ quality: 88 })
  .toFile(out);
console.log(`Contact sheet: ${out}`);
