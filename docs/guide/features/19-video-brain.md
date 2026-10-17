# Video Brain

The research behind every video the Video Studio makes. BuPulse's researchers watch real marketing videos on TikTok,
Facebook, Instagram and YouTube Shorts and write down how each one is made: the opening line, the timing, what
is on screen, how it asks people to order, and the post text under it. The Brain turns those notes into choices and
checks. Before Claude designs a video, the Brain tells it what works for this kind of business on this platform. After
Claude answers, the Brain marks the design out of 100 and lists what it missed.

The Brain is not an AI. It is a small database and plain rules, so the same product always gets the same advice, and
every piece of advice points back to the real videos it came from.

**Page:** the Video Studio, **Create** (`/create` on video.bupulse.com, or http://localhost:3100/create when it runs
on the Mac). The scores show on each video card and in the video's drawer.  **Plans:** the Video Studio is still in
testing; clients do not see it yet.

## The numbers

The one place to update when new research comes in (last updated 17 October 2026, after the comments research):

| What | Count |
| --- | --- |
| Research rows (videos, ads, captions and comments) | 538: TikTok 179, Facebook 110, Instagram 58, YouTube Shorts 36, post captions 125, clips whose comments were read 30 (450 comments) |
| Watched first-hand by a researcher | 344: TikTok 133, Facebook 90, Instagram 58, YouTube 36, TikTok captions 27 |
| Rwandan rows | 297 |
| Rows set aside as income-chain or scam posts | 8 |
| Openings (hooks) | 62 |
| Video formats | 10 |
| Business sectors | 11 |
| Rules | 81 (66 do, 15 don't) |
| Caption formulas | 28, plus 10 ways to order |

## What you see

On the **Create** page, under each finished video:

- **Research score 92/100.** How well the design follows the research. It appears on the card of every Motion video.
- **2 facts to check.** Numbers or claims in the video that are not in the product's facts. It appears only when there
  are some.

Open the video (click its card) to see the drawer:

- **Check these facts.** Each line says where it is and what was found: "scene 2 text: '15%' is not in the product's
  facts". Red lines are nowhere in the facts. Amber lines are only in the business's general description: true of the
  shop, maybe not of this product.
- **Research score 92/100: what it missed.** One line per missed rule, with the scene: "Scene 1: the price, number or
  call to action goes under the app's buttons".

Coming next: a **caption score** beside the post text, with what the caption is missing (the number, the price, the
place, the right number of hashtags).

(No screenshot yet: the score tags were added on 17 October and the page has not been photographed since.)

## What the Brain does to every video

1. **Reads the brief.** From the product and the business it works out the sector (a phone shop, a salon, a house for
   sale), the format (product reveal, before and after, tour, offer...) and the platform you picked under **Made for**.
2. **Picks three openings.** These are the hooks that worked best in the research for this sector and platform, and
   that only use facts the product has. With no price, it offers no price hook. With no phone number, it offers no
   "number on screen" hook. For a Kigali phone shop on Facebook, for example: the number on screen with the phone in a
   hand; the seller at the counter with a price bar; the price from the first frame.
3. **Sets the pacing.** A timeline second by second ("0-2 s: the phone already moving, price strip on top; 13-15 s:
   'WhatsApp 0788…' big in the middle"), stretched or squeezed to the length you chose.
4. **Keeps text where people can see it.** Each app covers part of the screen with its own buttons and captions. The
   Brain tells Claude to keep the price, the number and the call to action inside the safe area:
   - TikTok and Instagram: above the bottom 22%.
   - Facebook: above the bottom 15%.
   - YouTube Shorts: between the top 10% and the bottom 25%.
   - TikTok and Shorts also keep the right edge free.
5. **Chooses the sound.** A music mood from BuPulse's own library for the sector (afro for salons, fashion and
   travel; calm for clinics and schools), never a trending song, and a voice only when a person carries the clip. The
   video must work with the sound off: everything said is also on screen.
6. **Gives the rules and the don'ts.** For example: put the price in the first frame; keep the number on screen to the
   end; name one way to order. And never: a fake Mobile Money "income" screenshot, "the cheapest in Kigali" unless you
   wrote it, or a skin or weight before-and-after.
7. **Checks the result.** When Claude's design comes back, the Brain gives it the research score (below). The fact
   check lists any number or claim that is not in your facts.
8. **For Seedance clips**, it also tells the prompt writer to keep the clip free of text, because BuPulse adds the
   price and the number on top afterwards, and it scores the prompt the same way.

## What the scores mean

The **research score** adds up checks a computer can measure, such as:

- the hook is on screen in the first 1.5 seconds;
- the price is shown, and early;
- the number is in every scene and the last scene says how to order;
- every scene moves;
- the text is inside the safe area, and each voice line fits its scene;
- the caption has the number and the price;
- nothing is invented and nothing is on the do-not-copy list.

Checks that do not apply are left out. For example, there is no price check when the product has no price.

| Score | What it means |
| --- | --- |
| 95 to 100 | Follows the research. Post it after a look. |
| 85 to 94 | Good. Read "what it missed": usually one line sits too low or a voice line is too long. |
| 70 to 84 | Something important is missing (the price, the number, the way to order). Fix it or make it again. |
| Under 70 | Make it again, or edit it with the missed items as your note. |

The score does not judge taste: colours, photos and whether you like it are still your call. Luxury and cinematic
templates are allowed fewer words and a small, quiet phone line instead of a big bar.

The **caption score** (coming) checks the post text the same way:

- the product and the price in the first line;
- how to order and the phone number;
- where to find you (a landmark);
- the delivery line, when you deliver;
- Kinyarwanda when your business writes in Kinyarwanda;
- the hashtag habits of each platform: Facebook 0 to 3, TikTok and Instagram 4 to 6, Shorts 1 to 3.

These habits come from 125 real Rwandan and East African captions.

**Fact warnings** are not part of the score. They are there so nobody posts a price, a discount or a "free delivery"
that the business never offered.

## Learning from your own videos

Once your videos are posted through BuPulse, the Brain also learns from what they did. It reads the views, likes,
comments, saves and shares after one day and after one week.

- **Re-ranking.** Openings, formats and templates that worked for you move up, and so do those that worked for
  businesses like yours.
- **Your own results count most.** Your own videos weigh three times as much as other businesses'.
- **No fluke changes the advice.** An opening needs at least 5 posted videos before its results count. Below 20 videos
  it can move up, but it never pushes one of the research's top three out of the top three.
- **What Claude reads.** When there is enough, Claude's brief gets one line such as "What has worked for you (12 posted
  videos on TikTok): …".

## How the scam filter protects you

About half of the longest-running Rwandan ads in Facebook's ad library are income-chain posts ("Tajyira Akakanya
Gukorere Akayabo...", "earn 30K a day" recruiters) and fake Mobile Money "proof". They stay up for months because they
cost almost nothing and are posted again and again, not because they sell anything.

If the Brain trusted "running a long time" blindly, it would learn from them. So every research row is checked first.
A row that looks like an income chain, a recruiter, a "get rich" line or a MoMo screenshot is marked as a scam:

- Its age never counts as proof that something works.
- The Brain uses it only to teach the "never copy this" rules.

The automatic checks fail if any opening, format or rule tries to learn from such a row. The videos themselves are
also checked: an income claim or a payment screenshot in a design or a caption costs points and is listed in "what it
missed".

## How to add new research

1. The researchers add rows to their files in `docs/research/reels/`:
   - `tiktok.jsonl`, `facebook.jsonl`, `youtube.jsonl`;
   - `instagram.jsonl`, when it is ready;
   - `captions.jsonl`, for post captions.

   They also write what they found in the matching `-patterns.md` file. The Brain never changes their files.
2. Someone with the code on the Mac runs, from the BuPulse folder:

   ```
   node lib/video-engine/brain/ingest.ts
   ```

   This adds every new row to the Brain's index, gives it a short name (`fb-074`), and works out its country, its date
   and how strongly it shows "this works" (likes on TikTok and YouTube, days running and live versions on Facebook).
   Rows already in the index keep their names, even if the researcher edits them later. It is safe to run as often as
   you like.
3. While a researcher is still filling in rows, run:

   ```
   node lib/video-engine/brain/ingest.ts --no-new
   ```

   It refreshes the rows already in the index and leaves the unfinished ones out until they are ready. To leave a whole file
   out while it is being written, add `--skip=` and its name (for example `--skip=instagram`).
4. New openings, rules and sector notes are added by hand from the researchers' findings (the Brain agent does this).
   The automatic checks make sure every rule points at real rows.
5. Update **The numbers** above.

## Limits and settings

- The research block Claude reads is at most about 900 tokens (about 600 words). It adds about a quarter of a US cent to
  each design.
- The Brain only advises and checks. It never changes a design, and a low score never stops you from downloading or
  posting.
- East Africa is thin on Instagram (7 of 58 reels) and YouTube Shorts (few local ads); Facebook stays the main evidence
  for Rwandan ads.
- All the videos were watched with the sound off, so music and voice advice comes from articles, not from listening.

## For developers

### Where it lives

| Part | Where |
|---|---|
| Database | `lib/video-engine/brain/data/` (`evidence.json`, `hooks.json`, `formats.json`, `captions.json`, `rules.json`, `sectors.json`) |
| Types and checks | `lib/video-engine/brain/types.ts`, `lib/video-engine/brain/index.ts` (`BRAIN`, `checkBrain`, `SAFE_AREAS`, `safeAreaFor`) |
| Choosing advice | `lib/video-engine/brain/select.ts` (`brainFor`, `brainContext`, `brainBriefFromDesign`, `brainBriefFromPrompt`) |
| Scores | `lib/video-engine/brain/score.ts` (`scoreDesign`, `scoreCaption`, `scoreSeedancePrompt`, `templateStyle`) |
| Adding research | `lib/video-engine/brain/ingest.ts` (`evidenceFromRows`, `looksLikeScam`, `variantsLive`) |
| Where it is used | `lib/video-engine/designer.ts` (the research block and the score), `lib/video-engine/seedance-prompt.ts` (the research block for Seedance), `lib/video-engine/factcheck.ts` (the fact warnings), `video-lab/site/client/create.ts` (the score tags and the drawer) |
| Research | `docs/research/reels/*.jsonl` and `*-patterns.md` |
| Tests | `tests/video-engine/brain.test.ts` |
| Docs | [docs/research/BRAIN.md](../../research/BRAIN.md) (how it works, worked examples), [docs/research/brain-samples.md](../../research/brain-samples.md) (what Claude is told), [docs/research/brain-audit.md](../../research/brain-audit.md) (the audit of all templates) |

### Key functions

- `brainFor` (select.ts): the sector, format, three ranked hooks, timeline, rules and caption formula for one brief.
  Pure and deterministic.
- `brainContext` (select.ts): the same as a compact text block for Claude's brief. Rules the engine's own system
  prompt already gives are left out.
- `scoreDesign` / `scoreCaption` / `scoreSeedancePrompt` (score.ts): 0 to 100, with `passed` and `failed` items. Each
  item has the rule, a plain reason and the scene. The thresholds follow the template's style (direct, list, showcase,
  brand, luxury).
- `checkBrain` (index.ts): checks every id and reference in the database. Scam rows may only be cited by the
  fake-income and income-promise don'ts.
- `evidenceFromRows` (ingest.ts): turns research rows into index entries and keeps their ids (found by URL or key).

### How it works

1. The studio builds a `DesignBrief`. `designer.ts` calls `brainContext(brainBriefFromDesign(brief))` and sends it to
   Claude as a fenced research block.
2. Claude answers with a design. `validate.ts` repairs it, then `factCheck` and `scoreDesign` run, and the job saves
   `warnings` and `score`.
3. The page shows `score.score` on the card, and `warnings` and `score.failed` in the drawer.
4. New research: `node lib/video-engine/brain/ingest.ts` updates `evidence.json`, and `npx vitest run
   tests/video-engine/brain.test.ts` checks that everything still points at real rows.

## If something goes wrong

| Symptom | First place to look | Usual fix |
|---|---|---|
| No research score on a video | The job in `video-lab/data` (no `score`); `designVideo` in `lib/video-engine/designer.ts` | Only Motion videos made after 17 October have one; make the video again. |
| Score is low for a luxury or cinematic template | The drawer's missed items; `STYLE_LIMITS` in `lib/video-engine/brain/score.ts` | If a rule is wrong for that template, change its style or limit there and rerun the audit. |
| A price or a phone number is reported as "invented" when it is in the facts | `amounts` and `PHONE_RUN` in `score.ts`; `numbersIn` in `factcheck.ts` | Add the written form to the tests and fix the reader; check that the product's price field holds it. |
| The test says a rule "cites an income-chain or scam post" | `checkBrain` in `index.ts`; the row marked `scam` in `evidence.json` | Remove that row from the hook or rule; only the fake-income and income-promise don'ts may cite it. |
| The test says an evidence row "no longer matches a research row" | The researcher's file changed lines or wording | Run `node lib/video-engine/brain/ingest.ts` (add `--no-new` while rows are unfinished). |
| Claude's advice ignores the platform | The brief has no `platform` | Pick the platform under **Made for** on the Create page (it shows "Any platform" when none is chosen); without one the Brain gives general advice and the default safe area. |
