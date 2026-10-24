# Training Lab

An owner-only place in BuPulse Admin where the owner **teaches the AI by example**: they upload a reel or video and say
how it was made and what makes it good, add Kinyarwanda recordings with what is said, and add clips of actors who
agreed to be used. The video engine, the image and post engine, and the posting and scheduling engine read this
library and follow it, the way the Kigali car-seller reel shaped the round-3 reel montage (docs/REEL_ENGINE.md).

## Owner decisions (24 October 2026)
- **Where:** an Admin-only "Training Lab" in BuPulse, on the test site first; branch `training-lab` in
  `/Users/macbook1/BuPulse-training`, merged by the main session. The video editor is shared with the Video Studio
  (studio.bupulse.com, the video-engine agent): build it so the Studio can use it, and tell video-engine.
- **Kinyarwanda voice: free first.** Recordings with their text teach words, phrases, spelling and accent notes for
  scripts, captions and checks. A custom paid voice comes later, only with the owner's OK.
- **The loop:** auto mode, a lead on Opus 5.5 with at most 2 helpers, about 8 hours, steady use of the Claude usage.
- **CapCut:** no reverse engineering of its app. Our own editor, built on our encoder (`encodeSpecMp4` and its
  MotionSpec, which already does cuts, beat sync, transitions, 3D stickers and word-by-word captions), learning from
  CapCut's public features.

## What "training" means here
Google's and Anthropic's models are not retrained. The Lab is a **library of examples with notes and ratings** that the
engines read when they plan: viral recipes, shot lists, edit styles, music and beat habits, Kinyarwanda phrases and
pronunciation, presenter looks, posting times. Ratings on what the engines then make ("more like this", "never this")
feed back into it. Build on what exists: the video brain (`lib/video-engine/brain/*`: evidence, `viral.ts` recipes,
outcomes), the reel engine's writer and checker (`lib/reel-engine/*`), the image engine's planner and checker
(`lib/image-engine/*`), and the publisher, Autopilot and daily posts.

## The agent team inside BuPulse (owner request, 24 October 2026)
The owner: the engine has **agents inside, each with one job** (videos, images, captions, scheduling), trained by the
Lab, running on the owner's Gemini API key, the Anthropic API key, and the Claude subscription while BuPulse is hosted
on the owner's Mac. In plain words: BuPulse is a small studio team. Each member does one thing, reads the Lab examples
for its job, and works on one "brain" the owner picks.

| Team member | Job | Engine (files) | Lab examples it reads | Brain today |
| --- | --- | --- | --- | --- |
| Researcher | The business, its products and photos, the brief | image engine `loadFacts` | none | the database (free) |
| Director | Picks the story, the shots, the camera, the viral recipe | reel `story.ts`, image `director.ts`, brain `viral.ts` | reels, videos, images (technique, rating) | rules (free) |
| Script writer | The reel's lines, title, caption, hashtags | reel `writer.ts` | reels, videos, Kinyarwanda phrases | Claude (API or subscription), Gemini for Kinyarwanda |
| Designer | The image or post idea, headline and layout | image `planner.ts`, `prompter.ts` | images and posts | Claude (API or subscription) |
| Caption writer | Post captions and hashtags | image `captioner.ts`, Autopilot writer | posts, Kinyarwanda phrases | Gemini or Claude |
| Painter | Start frames and images | `createEngineDesign` (Nano Banana) | images, actors (with consent) | Gemini API (paid, capped) |
| Filmmaker | AI clips | `lib/video-engine/veo.ts` (video-engine's) | none directly (the writer's prompt) | Gemini Omni (paid, capped) |
| Editor | Cuts, beats, stickers, captions into the MP4 | `buildMontageSpec`, the Lab editor | reels, videos (edit style) | rules, in the browser (free) |
| Checker | Watches and reads the result, sends back what is wrong | reel `checker.ts`, image `checker.ts`, `checkLanguage` | "never this" notes, Kinyarwanda words | Gemini (cheap) |
| Scheduler | When and how often to post on each network | Autopilot `learning.ts`, `planner.ts`, `best-time.ts` | schedule notes | rules (free) |

**How it works:** one registry (`lib/training-lab/agents.ts`) names every member, its job in plain words, its engine,
the Lab kinds it reads, and its brain: `gemini` (API key), `anthropic` (API key) or `claude-subscription` (the Claude
CLI, only on the owner's Mac, never on Netlify or Cloudflare, as `lib/image-engine/claude-cli.ts` already does). A
small router runs a member on its chosen brain and falls back to the next one that is available. Every call stays in
the AI ledger, under the member's name. Admin, Training Lab, **Team** shows a card per member: its job, how many Lab
examples it learns from, its brain (the owner can switch it), its last runs, their cost and their ratings.
Before any deploy to bupulse.com, members on the subscription must move to the API key (it is for the owner's own use).

## Task board
Status: Todo / Doing / Done / Waiting (owner). Keep it current; any round resumes from here.

### Phase 1: the library (foundation)
1. **Done** Map: one page in `docs/handovers/training-lab.md` on what each engine reads today and where a Lab example
   would plug in (video brain, reel writer/checker, image planner/checker, posting times).
2. **Done** Data model: a `TrainingExample` (kind: reel, video, image/post, voice, actor, schedule; the file in Storage;
   how it was made; what is good; tags such as sector, language, technique; rating; consent for people; which engines
   use it) with a new migration. Files in a private bucket path under the owner.
3. **Done** Admin page `Training Lab`: upload (file or link), the "how it was made" form in plain words, list, filter,
   rate, switch an example on or off for each engine. Phone width works.
4. **Done** (AI draft off until the owner sets a budget; notes by hand always) Analysis on upload (free or cheap, within caps): Gemini watches a video and drafts the notes (shots, cuts per
   second, beat sync, stickers, captions, hook, setting, music), which the owner corrects.

### Phase 1b: the agent team
A1. **Done** The registry and the brain router (`lib/training-lab/agents.ts`, `brains.ts`): members, jobs, Lab kinds,
    brain choice saved in the database (a small `AgentSetting` table), fallback order, tests. No engine changes yet.
A2. **Done** Admin, Training Lab, Team: a card per member (job, examples it reads, brain switch, last runs and cost
    from the AI ledger). Phone width works.
A3. **Done** (the script writer, the designer, the caption writer; the director and checker stay rules or fixed for now) The engines ask the router: the reel script writer, the designer and the caption writer use the member's
    chosen brain (they already choose between Claude and Gemini; this makes it the owner's switch).
A4. **Done** (AgentRun, lib/training-lab/runs.ts) Each member's run records which Lab examples it used, so a rating on the result goes back to them.

### Phase 2: the engines learn from it
5. **Done** (reel writer, clip checker, viral recipes in the reel engine, designer and Studio jobs; reviewed by video-engine) Video: the reel writer and `viralRecipe` take the best matching Lab examples (sector, language, technique)
   as references; the checker uses the owner's "never this" notes.
6. **Done** (no place yet to keep which examples an image batch read) Image and posts: the image planner and post writer take Lab examples (layouts, wording, style) the same way.
7. **Done** (posts per week stays the owner's setting) Posting and scheduling: Lab notes on best times, frequency and formats per network feed Autopilot and
   daily posts' plans.
8. **Done** (the form, the extras in every checkLanguage caller, the Studio jobs, and the reel's own lines with free spelling fixes) Kinyarwanda: recordings plus text become a phrase and pronunciation list used by the writers (spelling,
   natural phrases, words to avoid) and by caption checks; keep the audio for a future voice.
9. **Done** (portraits; actors with only a video wait for frames from video) Actors: consented clips and portraits become presenter options for the reel engine (`ReelPresenter`).

### Phase 3: the editor
10. **Done** (v1: demo or a finished reel, preview, timeline, inspector, undo, export in the browser; encoder items in docs/research/EDITOR.md wait for video-engine) A timeline editor on the MotionSpec: trim, reorder, captions, stickers, transitions, music with beat
    marks, export through `encodeSpecMp4` in the browser. Start with editing a finished reel (its spec), then any
    uploaded clip. Coordinate with video-engine before touching shared encoder code (it is theirs: ask, do not edit).
11. **Done** "Teach from an edit": an edit the owner makes is saved as a Lab example (what was changed and why).

### Phase 4: the loop closes (added 24 October, while the owner was away)
12. **Done** Ratings feed back: the Team page rates what each member made, and "More like this" or "Never this" on a
    finished reel turns it into a Lab example (its MP4 copied privately into the Lab).
13. **Done** (the owner picks the moment in the browser) Actors with only a video: take a still frame for the presenter portrait.

14. **Done** The Editor opens a reel from a link (Team page, finished reels) and shows what the Lab did to it.
15. **Done** A Words tab: every Kinyarwanda spelling, right word and phrase the Lab teaches, in one place.
16. **Done** The owner's guide (docs/TRAINING_LAB_GUIDE.md).
17. **Done** Each example shows how much the team used it in the last 30 days.
18. **Done** Fixes from the review of 24 October: actor consent can be withdrawn (and removes the copies), no
    client's phone, link or price reaches another business's prompt, file replacement, duplicate reels, "7 am".
19. **Done** Images get the free Kinyarwanda spelling fixes (words on the picture and captions).
20. **Done** The reel Director leans toward the best-rated examples' hooks, shots and camera moves, never the "never" ones.
21. **Done** A Lab health list at the top of the Library.
22. **Done** The editor keeps a draft of each edit in the browser.
23. **Done** Autopilot's post writer and the daily posts read the Lab and fix the owner's spellings for free
    (and "Generate again").
24. **Done** Fixes from the second review (24 October): the clip checker gets only visual never-notes; the brain
    router stops on a budget or a switched-off service and never pays twice; the spelling fixer leaves links,
    hashtags and the business's own names alone; placeholders never reach a post.
25. **Done** Editor: speed (0.5x to 2x), clip sound level and fades, now that video-engine built them (81a02e83 on
    video-engine: `VideoLayer.rate`, `volume`, `fadeIn`, `fadeOut`). Waits for main to merge that batch into
    quiz-mode, then merge quiz-mode into training-lab. Ops must carry the next scene's `start` when a scene is slowed,
    and the UI says "Sound is off while the speed is not 1x".

### Phase 5: friendly (owner, 24 October, about 18:00)
The owner: the Lab "shouldn't display like that, make it friendly and a perfect training lab". Decisions:
- **Drop, read, check:** one big "Drop a reel, video, photo or voice note here (or paste a link)" box. The AI watches
  it and fills in everything (what it is, the hook, shots, cuts, beat, stickers, music, words, sector, language,
  techniques); the owner only checks, gives stars and saves. Examples show as a gallery of thumbnails, not a list.
- **AI reading budget: $2 in total for testing** (docs/AI_COSTS.md), switched on for the test site.
26. **Done** The drop, read and check flow (dc72bdd5).
27. **Done** The gallery of examples with a detail view (65f4733c), and a friendlier Team page (61763a32).

### Waiting (owner)
- A paid Kinyarwanda voice clone (cost and service), when the owner wants it.
- Any paid AI spend beyond the caps in docs/AI_COSTS.md.
- **Actor consent scope: decided (owner, 24 October): test site only for now.** Lab actors become presenters only on
  the test site (code: `labPresentersAllowed`, off on Netlify and Cloudflare). Before any launch it stays off until the
  actors' consent covers appearing for any business.
- **Clients' reels in the Lab** (from the review): "More like this", "Never this" and "Save as a Lab example" copy a
  client's finished reel into the Lab, where its style then teaches the engines for every business (phones, links and
  prices are scrubbed, and the prompts say never to use other businesses' names). Check this against BuPulse's terms
  before it is used on bupulse.com.

