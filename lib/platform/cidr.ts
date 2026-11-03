// IP address ranges (CIDR) for the Cloud Run header rules in lib/platform/headers.ts. Pure, no imports.

/** Cloudflare's published ranges (https://www.cloudflare.com/ips-v4 and ips-v6, checked 3 November 2026). */
export const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

/** Google's front ends and load balancers (the source ranges Google documents for its proxies and health checks). */
export const GOOGLE_FRONT_END_RANGES = ["35.191.0.0/16", "130.211.0.0/22"];

type Parsed = { v: 4 | 6; n: bigint };

function parseV4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << BigInt(8)) | BigInt(Number(p));
  }
  return n;
}

function parseV6(ip: string): bigint | null {
  let text = ip.toLowerCase();
  // An IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = parseV4(tail[2]);
    if (v4 === null) return null;
    text = `${tail[1]}${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** An IPv4 or IPv6 address as a number, or null when it is not one. IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as IPv4. */
export function parseIp(raw: string | null | undefined): Parsed | null {
  const ip = (raw ?? "").trim();
  if (!ip || ip.length > 45) return null;
  if (!ip.includes(":")) {
    const n = parseV4(ip);
    return n === null ? null : { v: 4, n };
  }
  const n = parseV6(ip);
  if (n === null) return null;
  if (n >> BigInt(32) === BigInt(0xffff)) return { v: 4, n: n & BigInt(0xffffffff) };
  return { v: 6, n };
}

/** True when `ip` is inside one of the `ranges` ("a.b.c.d/n" or "x::/n"). False for anything that is not an address. */
export function inRanges(ip: string | null | undefined, ranges: readonly string[]): boolean {
  const addr = parseIp(ip);
  if (!addr) return false;
  for (const range of ranges) {
    const [base, bitsText] = range.split("/");
    const net = parseIp(base);
    const width = addr.v === 4 ? 32 : 128;
    const bits = Number(bitsText);
    if (!net || net.v !== addr.v || !(bits >= 0 && bits <= width)) continue;
    const shift = BigInt(width - bits);
    if (addr.n >> shift === net.n >> shift) return true;
  }
  return false;
}
