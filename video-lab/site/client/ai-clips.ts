// "AI makes the clips" on the Create page (docs/VIDEO_ENGINE.md, "Veo AI clips"): the choice in the Motion options,
// with its credit price, and the step before the design that asks the studio for 2 or 3 Google Veo clips of the
// product and waits for them ("Making AI clip 2 of 3…"). The clips' ids then go with the design request (`aiClipIds`).
// Kept in its own file so the Create page only calls into it (video-lab/ai-clips.ts is the server side).
import { api, el } from "./site";

export type AiClipsStatus = { available: boolean; reason: string | null; credits: Record<string, number>; perVideo: { min: number; max: number } };
type ClipView = { id: string; status: string; shot: string; error: string | null; url: string | null };
type RunView = { id: string; done: boolean; ready: string[]; message: string; clips: ClipView[] };

/** The page's choice: 0 (off), 2 or 3 clips of `seconds` each (4 s while the owner tests: the cheapest). */
export const aiClips = { status: null as AiClipsStatus | null, count: 0, seconds: 4 };

export async function loadAiClipsStatus(): Promise<AiClipsStatus | null> {
  aiClips.status = await api<AiClipsStatus>("/api/ai-clips/status").catch(() => null);
  if (!aiClips.status?.available) aiClips.count = 0;
  return aiClips.status;
}

/** Credits the clips add to the video (made once, shared by every version). */
export const aiClipsCredits = () => (aiClips.count && aiClips.status ? aiClips.count * (aiClips.status.credits[String(aiClips.seconds)] ?? 0) : 0);

/** The block in the Motion options: off, 2 or 3 clips with their price, or why AI clips are not available. */
export function aiClipsOptions(onChange: () => void): HTMLElement {
  const box = el("div", { className: "ai-clips" });
  const s = aiClips.status;
  box.append(el("h6", { textContent: "AI makes the clips (Google Veo)" }));
  if (!s?.available) {
    box.append(el("p", { className: "hint", textContent: s?.reason ?? "AI clips are not available right now. Your video is made from your photos." }));
    return box;
  }
  const each = s.credits[String(aiClips.seconds)] ?? 0;
  const row = el("div");
  for (const n of [0, s.perVideo.min, s.perVideo.max]) {
    const b = el("button", { className: `btn sm${aiClips.count === n ? " on" : ""}`, textContent: n ? `${n} clips · ${n * each} credits` : "Off", style: "margin:0 6px 6px 0" });
    b.onclick = (e) => {
      e.stopPropagation();
      aiClips.count = n;
      row.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      onChange();
    };
    row.append(b);
  }
  box.append(row, el("p", { className: "hint", textContent: `Real moving clips of your product (${aiClips.seconds} s each, ${each} credits a clip), made from its photo and mixed into the video with your music and voice-over. About 1 minute a clip. A clip that cannot be made gives its credits back.` }));
  return box;
}

/**
 * Makes the clips and waits for them, saying where it is through `say`. Returns the ready clips' ids; throws when none
 * could be made (the credits are already back then). `needs`: a viral recipe's clip needs, when the page has them.
 */
export async function makeAiClips(input: { businessId: string; productId: string; ratio: string; photoIds: string[]; needs?: unknown[] }, say: (text: string) => void): Promise<string[]> {
  if (!aiClips.count) return [];
  say(`Asking Google Veo for ${aiClips.count} AI clips…`);
  let { run } = await api<{ run: RunView }>("/api/ai-clips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, ratio: input.ratio === "16:9" ? "16:9" : "9:16", count: aiClips.count, seconds: aiClips.seconds }),
  });
  // Google takes about a minute a clip (up to 6 at busy times); the studio gives up on a clip after 10 minutes.
  const until = Date.now() + 12 * 60_000;
  while (!run.done && Date.now() < until) {
    say(run.message);
    await new Promise((done) => setTimeout(done, 4000));
    run = (await api<{ run: RunView }>(`/api/ai-clips/runs/${run.id}`)).run;
  }
  say(run.message);
  if (!run.ready.length) throw new Error(run.message);
  return run.ready;
}
