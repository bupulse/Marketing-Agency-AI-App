// Puts ready pictures and videos on the waiting posts that never got them (owner report, 11 November 2026: Daily posts
// on "Needs your OK" said "No picture yet" while their pictures showed under "Pictures and videos"). The selection and
// the attach are the app's own (lib/visuals/reattach.ts, through app/api/cron/attach-visuals on the running server), so
// music credits and auto-approval work exactly as when a picture is finished.
//
// Run on the PC through server.mjs (production settings in memory only):
//   node scripts/self-host/windows/server.mjs tool attach-ready-visuals                       dry run: lists, changes nothing
//   node scripts/self-host/windows/server.mjs tool attach-ready-visuals --apply               puts the pictures on
//   node scripts/self-host/windows/server.mjs tool attach-ready-visuals --business <id> [--apply]   one company only
//
// Only posts not posted yet (Draft or Needs your OK), not edited by the owner and not being published, from Create
// today's content, Daily posts or Autopilot, with no media at all. Scheduled, posted and owner-edited posts are never
// touched. The server must be running (127.0.0.1:3002).

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const at = args.indexOf("--business");
const businessId = at >= 0 ? args[at + 1] : undefined;
const known = new Set(["--apply", "--business"]);
const unknown = args.filter((a, i) => !known.has(a) && !(at >= 0 && i === at + 1));
if ((at >= 0 && !/^[A-Za-z0-9_-]{1,64}$/.test(businessId ?? "")) || unknown.length) {
  console.error("Usage: ... tool attach-ready-visuals [--apply] [--business <business id>]");
  process.exit(1);
}
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set: run this through server.mjs (node scripts/self-host/windows/server.mjs tool attach-ready-visuals).");
  process.exit(1);
}
const base = "http://127.0.0.1:3002";

let res;
try {
  res = await fetch(`${base}/api/cron/attach-visuals`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apply, ...(businessId ? { businessId } : {}) }),
  });
} catch (error) {
  console.error(`The server did not answer at ${base} (${error instanceof Error ? error.message : error}). Is it running?`);
  process.exit(1);
}
if (res.status === 404) {
  console.error("The server does not know this tool yet: build and restart it with the new version first.");
  process.exit(1);
}
if (!res.ok) {
  console.error(`The server answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const answer = await res.json();

console.log(`\n${answer.count} waiting post(s) with no picture whose pictures are ready${businessId ? ` (business ${businessId})` : ""}:`);
for (const p of answer.posts) {
  console.log(`  ${p.id}  ${p.network.padEnd(9)} ${p.status.padEnd(16)} ${p.source.padEnd(9)} business ${p.businessId}`);
  console.log(`      would get: ${p.media} from ${p.from}; format ${p.format}; "${p.text}"`);
}
if (!answer.apply) {
  console.log(answer.count ? `\nDry run: nothing was changed. To put these pictures on, run the same command with --apply.\n` : "\nNothing to do.\n");
  process.exit(0);
}
const r = answer.result;
console.log(`\nDone: ${r.attached} post(s) now have their picture or video, ${r.unchanged} unchanged (changed or locked meanwhile), ${r.failed} failed (see Admin -> Errors).\n`);
process.exit(r.failed ? 2 : 0);
