// Records width/height of every screenshot (PNG header) into src/screen-dims.json. Run after capturing.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "public/screens";
const out: Record<string, [number, number]> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".png")) {
      const b = readFileSync(p);
      out[p.slice(root.length + 1, -4)] = [b.readUInt32BE(16), b.readUInt32BE(20)];
    }
  }
};
walk(root);
writeFileSync("src/screen-dims.json", JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, "screens");
