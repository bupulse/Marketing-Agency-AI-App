#!/usr/bin/env node
// Makes the phone-app icons in public/icons from the brand icon (public/brand/icon.png), with sharp, locally:
//   icon-192.png, icon-512.png   the brand icon as it is (rounded corners), for the manifest ("any")
//   maskable-512.png             full-bleed brand gradient with the white mark inside the 80 % safe circle, so Android
//                                can cut it to a circle, squircle or square without losing the mark
//   apple-touch-icon.png         180 px, full bleed (an iPhone fills transparent corners with black, then rounds)
// Run again after the brand icon changes: node scripts/make-app-icons.mjs
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "public/brand/icon.png";
const OUT = "public/icons";
// The brand icon's gradient, read off its pixels: blue at the top left, violet at the bottom right.
const FROM = "#1361f7";
const TO = "#6c58f4";

/** The white mark of the brand icon on a transparent background, cropped to its edges. */
async function whiteMark() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      // The gradient never has red and green above about 100; the mark is white (anti-aliased at its edges). The mark
      // stays 30 px from the edges, where the rounded corners' anti-aliasing leaves a few light pixels.
      const inside = x >= 30 && y >= 30 && x < info.width - 30 && y < info.height - 30 && data[i + 3] === 255;
      const alpha = inside ? Math.max(0, Math.min(1, (Math.min(data[i], data[i + 1]) - 100) / 155)) : 0;
      out[i] = out[i + 1] = out[i + 2] = 255;
      out[i + 3] = Math.round(alpha * 255);
      if (alpha > 0.5) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
}

/** A square of the brand gradient with the mark centred, `share` of the width wide. */
async function fullBleed(size, mark, share) {
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${FROM}"/><stop offset="1" stop-color="${TO}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const inner = await sharp(mark).resize({ width: Math.round(size * share) }).toBuffer();
  return sharp(background).composite([{ input: inner, gravity: "centre" }]).png({ compressionLevel: 9 });
}

await mkdir(OUT, { recursive: true });
for (const size of [192, 512]) {
  await sharp(SOURCE).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile(`${OUT}/icon-${size}.png`);
}
const mark = await whiteMark();
// The mark is about 1.5 times as wide as it is high: 60 % of the width keeps its corners inside the safe circle.
await (await fullBleed(512, mark, 0.6)).toFile(`${OUT}/maskable-512.png`);
await (await fullBleed(180, mark, 0.72)).toFile(`${OUT}/apple-touch-icon.png`);
console.log(`Icons written to ${OUT}.`);
