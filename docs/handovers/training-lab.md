# Training Lab handover

## For the owner (draft at 15:22; the final version replaces it when the loop stops)
**What you have now (on branch training-lab; the main session puts it on test.bupulse.com):**
- **Admin, AI, Training Lab**, only for you, with four tabs:
  - **Library:** add a reel, video, image or post, a Kinyarwanda recording, an actor (consent first) or a posting
    schedule, and say in your own words how it was made, what is good and what to never do. Rate it, switch which
    engines may learn from it, write notes (or let Gemini draft them once you set a budget). Finished reels can be
    added with "More like this" or "Never this". A health list says what to fix.
  - **Team:** BuPulse's 10 helpers, each with one job. For the Script writer, Designer and Caption writer you choose
    the brain: Gemini, Claude on the API key, Claude on your subscription (only on your Mac), or free rules.
  - **Editor:** open a finished reel, change the shots, words, stickers and look, export the MP4, or save the edit
    as an example so the engines learn from it.
  - **Words:** every Kinyarwanda spelling to avoid, right word and phrase the Lab teaches.
- **The engines now learn from it:** reels (script, shots, viral style, checker, presenters), images and captions,
  posting times, and the Kinyarwanda checks, which also fix your marked spellings for free. With an empty Lab
  everything works exactly as before.
- **How to start:** docs/TRAINING_LAB_GUIDE.md (one page, plain English).

**Waiting for you (on the board in docs/TRAINING_LAB.md):** a small budget for AI notes; whether one consenting actor
may present for many businesses; whether clients' reels may teach the Lab for everyone (check the terms); a paid
Kinyarwanda voice later.

**No money was spent and nothing was published.** All checks pass (5,631 tests).

## Loop log
- **Start:** Saturday 24 October 2026, 11:47 CAT. Owner away about 8 hours; the loop stops about 19:45 CAT.
- Lead: Opus 5.5; at most 2 helpers (Opus 5.5 or smaller), one small task each.

## Decisions made while the owner was away (local, reversible)
- Owner (11:55): Claude in Chrome may be used for testing; the owner leaves Admin logged in. Use it read-only on the test
  site and my own check server (port 3004); never publish, post or send anything from the browser.
- 12:00: the TrainingExample migration (and its private `training-lab` bucket) applied to TEST with `prisma migrate
  deploy`; it was the only pending one. Additive, nothing else changed.
- 12:02: owner asked for an agent team inside BuPulse (one job per member, on Gemini, the Anthropic key or the Claude
  subscription while hosted on the Mac). Designed it as a registry plus a brain router and an Admin Team page
  (docs/TRAINING_LAB.md, "The agent team"); tasks A1 to A4 on the board. The subscription stays local-only, as
  lib/image-engine/claude-cli.ts already enforces.
- 12:12: video-engine (bupulse-video-0f) agreed that this branch adds the optional `lab`/`avoid` to brain/viral.ts and
  `extra` to brain/language.ts, on conditions: bit-for-bit the same without them, Lab bonus at most +15, ids `lab:<id>`,
  avoid subtracts like -25 and never filters, existing brain tests unchanged; send them the hash to review before main
  merges that part. Encoder changes (speed, audio fades, beats in the spec) stay theirs: ask first.
- Admin login on the test site does not carry to my check server (port 3004), so browser checks happen on the test
  site after main merges.
- 12:18: main merged up to b235f858 to test.bupulse.com (full vitest 5390 passed). Chrome check (read-only, no forms):
  the Library and Team pages load as the owner, no console errors. Team page findings to fix: (1) it says "Your
  choice ... is not available" for a default the owner never chose; (2) only the script writer asks the router so far,
  so the other members' switches do nothing yet and must say so; (3) the script writer's default sends Kinyarwanda to
  Gemini, which the card should say. Phone width not checked: the window resize did not apply in this Chrome.
  Main asked whether this session signed in on the test site (its session lands on /welcome since about 11:15): no.
- 12:23: brain hooks (viral.ts, language.ts) committed 0e4fd8e0 and sent to video-engine for review; they are not wired
  into any engine until video-engine says OK. Team page imported claude-cli directly (a guard failure); it now asks
  brains.ts (37940095).
- 12:25: video-engine approved 0e4fd8e0. Before wiring: (1) recipeText (viral.ts ~581) and the why-text (~631) must
  credit `lab:` sources to "your Training Lab" (pass the Lab through); (2) when checkLanguage gets `extra`, pass it in
  both callers, designer.ts:427 and suggest.ts:300. Send them the wiring commit for a quick review. NEXT TASK QUEUED.
- 12:32: video-engine approved d0f42915 (viral wiring), asking that a low rating penalise only `lab:<id>` (an opening
  type only by an explicit `never_hook` note or `never:<hook>` tag) and giving the go-ahead to wire
  lib/video-studio/jobs.ts. Send them the hashes of that fix, jobs.ts and the checkLanguage commits (4659930f, baa00bd9).
- 12:46: video-engine approved everything on this branch that touches its code (up to 669b9d92). Full vitest 5523
  passed after fixing .env.example (settings must be empty). Main asked to merge up to 6bad0208.
- 12:53: main put 6bad0208 on the test site. Chrome (read-only): the Library and Editor load; "Open" on a real LEAF
  reel builds its 30 s, 20-shot spec with the Kinyarwanda captions, and the preview draws the clips after about 7 s
  of downloading (black until then, with no message: to fix). The editor's picker says "not saved until you export",
  which contradicts "Export alone saves nothing" (to fix). Main raised the actor consent scope with the owner (on the
  board, Waiting).
- 13:03: full vitest 5588 passed; main asked to merge up to 588da03a. A read-only review of the Lab's server side
  (helper): owner checks, private storage and spend are fine; fixes under way for consent withdrawal and for a client's
  phone, link or price reaching other businesses' prompts. The policy point on clients' reels is on Waiting.
- 17:38: main put 488853cb on the test site. Owner decision (through main): Lab actors as presenters on the test
  site only; enforced in code (b51a38ce, `labPresentersAllowed`). Chrome (read-only, about 17:40): Library with the
  health line and the 4 finished LEAF reels, Words (empty state), Team (the Director's note, the default notes, the
  subscription warning), and the Editor opened by link with "Loading the clips… 0 of 7" and the Lab notes panel: all
  render, no errors. video-engine built speed and clip sound for the editor (81a02e83, theirs): task 25 waits for it
  to reach quiz-mode.
- 17:58: main put a10c5a35 on the test site (quiz-mode merged into training-lab first, a fast-forward, bringing
  video-engine's VideoLayer rate, volume and fades). Chrome (read-only): the editor opened by link shows the new
  "Clip speed and sound" group for a real LEAF reel shot. ef76b9b3 (speed and trims stop at the clip's end) sent to main.
- 18:03: the OWNER (back briefly): the Lab "shouldn't display like that, make it friendly and a perfect training lab".
  Chose "Drop, read, check" (one drop box, the AI fills everything, the owner checks and saves; a gallery of
  thumbnails) and a $2 test budget for the AI reading examples (docs/AI_COSTS.md; my .env set; main asked to set it on
  the test site). Board tasks 26 (drop, read, check) and 27 (gallery) given to the two helpers.
- 18:44: friendly Lab live (4f31243b). End-to-end test in Chrome (approved by main, one paid call): dropped the
  BuPulse logo; upload and the check card worked at phone width, but Gemini answered 400 (an empty "" enum value in
  the answer schema; free). Fixed in 2bb03ae1 ("unknown" instead), with a test that no enum value is empty. Discard
  removed the draft (0 files left in drafts/). Retest at 18:56 after the fix went live: Gemini read the logo and filled in the card correctly
  ($0.0022), Discard left 0 draft files. Drop, read, check works end to end.

## Map: what each engine reads today, and where a Lab example plugs in
Read from the code on 24 October 2026. Line numbers are on branch training-lab. Rule for every plug-in below: one small
reader `labExamples({ sector, language, technique, kind })` in a new `lib/training-lab/` (server, DB), returning plain
data; the engines get it as a new optional parameter, so nothing changes when the Lab is empty. Pure files stay pure.

**1. Video brain (`lib/video-engine/brain/*`)**
- Today it reads only static JSON in `brain/data/` (evidence, hooks, formats, rules, sectors, captions, `viral.json`), plus
  `Outcome` rows of posted videos (`outcomes.ts`: `rankWithOutcomes` :90, `outcomesLine` :130).
- `viralRecipe(input)` viral.ts:383 builds the recipe. `scoreViral` :208 ranks the `VIRAL` array (:16) by sector (+40),
  neighbour sector (+22), platform (+15), Rwanda (+18), strength, "used recently" (-25) and a random 28. `pickViral` :237
  takes 3 to 5. `RecipeInput` is :32. Callers: `recipeForBrief` designer.ts:~320 and reel engine.ts:137.
- **Plug-in A (best examples):** `scoreViral`/`pickViral` take the library as a parameter, not the `VIRAL` constant:
  `RecipeInput.lab?: ViralVideo[]`; Lab reels are mapped to `ViralVideo` rows (same shape as `viral-ingest.ts`) and get a
  bonus for owner rating. Add `RecipeInput.avoid?: string[]` for "never this" (subtract like the -25 at :232).
- **Plug-in B (prompt text):** `brainContext(brief, opts)` select.ts:371 builds the "What works" text (capped by
  `CONTEXT_MAX_CHARS` :18). Add `opts.lab?: string[]` lines, appended after the `worked` outcomes line. Callers: designer.ts:210,
  seedance-prompt.ts:57, video-studio/jobs.ts:156.
- **Plug-in C (score):** `scoreDesign` score.ts:190 and `NEVER` :150 hold the "never" rules; Lab "never this" notes become extra
  `Check`s only if they are machine-checkable (words, a layout); otherwise they go in B as text.
- Risk: `viral.json` is generated by `viral-ingest.ts` from docs/research; do not write Lab rows into it.

**2. Reel engine (`lib/reel-engine/*`)**
- `startReel` engine.ts:121 gathers inputs: `loadFacts` (image engine), `ensurePresenter` :82, `directMontage` story.ts:190
  (3 talking clips + 4 product shots, least-used variant and camera first), `sectorFromText`, then `viralRecipe` :137, then
  `writeReel` :97 which sends `reelPrompt(input)` writer.ts:95 (system text `REEL_SYSTEM` :60) to Claude or Gemini.
- `ReelInput` writer.ts:13 is the injection point. Add `lab?: { examples: string[]; avoid: string[]; phrases: string[] }`
  and one line in `reelPrompt`, next to `recipeLines(input.recipe)` (:117): "OWNER'S EXAMPLES ... / NEVER ...". The
  Kinyarwanda phrase list goes here too (the prompt says only "correct, natural Kinyarwanda", writer.ts:70).
- Presenter: model `ReelPresenter` (schema.prisma:1342, one row per business: `path`, `description`).
  `presenterDescription` :72 invents a look from a hash. Plug-in: `ensurePresenter` picks an owner-approved actor clip/photo
  from the Lab (sector + audience match) before it paints one; store its path in `ReelPresenter.path`. No schema change needed.
- Checks: `CLIP_CHECK_PROMPT` checker.ts:12 is a fixed list of visual faults sent to Gemini in `checkClip` :36. "Never this"
  visual notes from the Lab (rated bad reels) append to this prompt as extra FAIL lines.
- Risk: `veoClipPrompt` story.ts:226 and `lib/video-engine/veo.ts` feed Veo; the video-engine session owns veo.ts (read-only).
  Change prompts upstream (writer), never there. The Veo price rule (story.ts:~205 `spokenLine`) must stay.

**3. Image engine (`lib/image-engine/*`)**
- `planBatch` engine.ts:93 -> `loadFacts` :52 (business, product, reviews) -> `directBatch` director.ts:73 (picks pattern,
  shot, light, layout, camera from `PATTERNS` in patterns.ts:20, least used first, `prefer` from the brief) -> `writeConcepts`
  planner.ts:82 -> `plannerPrompt` prompter.ts:89 (system `PLANNER_SYSTEM` :49) -> `captionBatch` captioner.ts:11.
- **Plug-in A:** `PlannerInput` prompter.ts:27 gets `lab?: { examples: string[]; avoid: string[] }`, printed in
  `plannerPrompt` after the RECENT line. Filled in `planBatch` (engine.ts:~110) where `input` is built.
- **Plug-in B:** `directBatch({ prefer })` director.ts:73: Lab image examples with a known `pattern` raise that pattern;
  "never" lowers it. `CaptionInput` captions.ts:4 gets the same `lab` for caption style.
- Checks: `judge` checker.ts:48 is text/product only; no language check exists in the image engine (see 5).

**4. Posts and posting times**
- Writing: `runAutopilot` autopilot/run.ts:114 -> `buildPrompt` autopilot/writer.ts:102 (system `SYSTEM` :69). It already takes
  `brand.industryContext` (lib/industry-context.ts) and `brand.profile`; add `brand.labExamples?: string` beside them
  (run.ts:158). Daily posts (`runDailyPosts` daily-posts/service.ts:112) go through `runDayContent` (content-flow), not
  the autopilot writer; same plug-in there. Ideas: `IDEAS` playbook.ts:53, chosen by `chooseIdea` learning.ts:185
  (explore 30%, else best learned score x weight x recency): Lab "works well" can raise `idea.weight`, "never" removes it.
- Times: three places choose them.
  1. `NETWORK_DEFAULTS` learning.ts:118 (hours and weekdays per network, static) and `preferredHours`/`preferredWeekdays`
     :134/:128 (learned from `buildProfile` :74 only when `confident`, >= `MIN_POSTS_TO_LEARN` 6). **Best plug-in for
     posting-time notes:** make these two functions merge Lab time notes (by network, country) between learned and default.
  2. `buildWeekPlan` autopilot/planner.ts:169 -> `slot()` :~355 orders the owner's `postingTimes` by closeness to
     `preferredHours`; it never adds hours the owner did not allow. Keep that rule (comment :352).
  3. `bestTime` publishing/best-time.ts:27 (called publishing/service.ts:351) does the same for manual posts. Both read
     `preferredHours`, so one change in learning.ts covers both.
- Frequency: `settings.ts` (`MIN/MAX_POSTS_PER_WEEK` 2/14) and plan limits; owner-controlled, do not let the Lab override.
- Risk: learning.ts and planner.ts are pure and unit-tested; pass Lab data in as arguments (`LearningProfile` gets
  `labHours?: Map<Network, number[]>`), never import the DB there.

**5. Language and Kinyarwanda**
- `brain/language.ts`: `checkLanguage(texts, language)` :92 is a word-list check (`KINYARWANDA_COMMERCE` :13,
  `PREFERRED_PHRASES` :35, `hasKinyarwanda` :53, French lists); it flags only forms the 125-caption corpus never uses.
  Used by `designer.ts:427`, `suggest.ts:300` (hook lines). `voice-language.ts` `looksKinyarwanda` :42 is the sentence test.
- **Plug-in:** `checkLanguage(texts, language, extra?)` with `extra.words` (Lab words and phrases marked correct) so they are
  never flagged, and `extra.wrong` (spellings the owner marked wrong) which are always flagged. `PREFERRED_PHRASES` also
  accepts Lab phrases for the designer's prompt (designer.ts imports it, :16).
- Gaps: the reel engine (`readReel` writer.ts:130) and the image engine (`readConcepts` prompter.ts:143, `readCaptions`
  captions.ts:41) do not call `checkLanguage` at all. Cheapest win: call it on reel `line`s and image headlines/captions and
  retry or fall back to `ruleReel`/`ruleConcept` on a flag.
- Voice recordings: no engine reads audio; the Lab stores the audio with its text and uses only the text and accent notes.

**Order I would build in:** (1) reader + `labExamples`; (2) `reelPrompt` and `plannerPrompt` lines (smallest, visible);
(3) `scoreViral` bonus/avoid; (4) `preferredHours` merge; (5) `checkLanguage` extras and wiring into reel/image.

## Rounds
- Round 1 (11:47): task 1 map (helper, done 11:49 and reviewed), task 2 data model (helper, done 12:00, committed 3f511afb).
- Round 2 (12:03): task 3 Admin page (model-helper), task 10 step 1 editor ops (map-helper, committed faaaa63f), A1 registry and router (map-helper, committed 5dad45ad, migration applied to TEST).
- Round 3 (12:08): A4 run log `AgentRun` (map-helper, aa359857); the agent id is kept in our own table, not in the shared AiCall ledger. Lab reader (fe006222). Task 3 Admin page (model-helper, 22ae45bc).
- Round 4 (12:13): task 5 reel engine reads the Lab (map-helper, 41efc508; the checker gets only the owner's "Never"
  lines), A2 Team page (model-helper, 17d8ce8b).
- Full vitest (12:10): 2 failures from this branch in the subscription guard test; the router is now its second allowed
  user behind the same lock (b235f858). Main asked to merge up to b235f858.
- Round 5 (12:12): brain hooks viral.ts and language.ts with video-engine's conditions (map-helper), A3 script writer on
  the router and the registry's Lab engines (model-helper).
