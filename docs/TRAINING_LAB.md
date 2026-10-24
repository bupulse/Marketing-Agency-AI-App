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

## Task board
Status: Todo / Doing / Done / Waiting (owner). Keep it current; any round resumes from here.

### Phase 1: the library (foundation)
1. **Done** Map: one page in `docs/handovers/training-lab.md` on what each engine reads today and where a Lab example
   would plug in (video brain, reel writer/checker, image planner/checker, posting times).
2. **Doing** Data model: a `TrainingExample` (kind: reel, video, image/post, voice, actor, schedule; the file in Storage;
   how it was made; what is good; tags such as sector, language, technique; rating; consent for people; which engines
   use it) with a new migration. Files in a private bucket path under the owner.
3. **Todo** Admin page `Training Lab`: upload (file or link), the "how it was made" form in plain words, list, filter,
   rate, switch an example on or off for each engine. Phone width works.
4. **Todo** Analysis on upload (free or cheap, within caps): Gemini watches a video and drafts the notes (shots, cuts per
   second, beat sync, stickers, captions, hook, setting, music), which the owner corrects.

### Phase 2: the engines learn from it
5. **Todo** Video: the reel writer and `viralRecipe` take the best matching Lab examples (sector, language, technique)
   as references; the checker uses the owner's "never this" notes.
6. **Todo** Image and posts: the image planner and post writer take Lab examples (layouts, wording, style) the same way.
7. **Todo** Posting and scheduling: Lab notes on best times, frequency and formats per network feed Autopilot and
   daily posts' plans.
8. **Todo** Kinyarwanda: recordings plus text become a phrase and pronunciation list used by the writers (spelling,
   natural phrases, words to avoid) and by caption checks; keep the audio for a future voice.
9. **Todo** Actors: consented clips and portraits become presenter options for the reel engine (`ReelPresenter`).

### Phase 3: the editor
10. **Todo** A timeline editor on the MotionSpec: trim, reorder, captions, stickers, transitions, music with beat
    marks, export through `encodeSpecMp4` in the browser. Start with editing a finished reel (its spec), then any
    uploaded clip. Coordinate with video-engine before touching shared encoder code (it is theirs: ask, do not edit).
11. **Todo** "Teach from an edit": an edit the owner makes is saved as a Lab example (what was changed and why).

### Waiting (owner)
- A paid Kinyarwanda voice clone (cost and service), when the owner wants it.
- Any paid AI spend beyond the caps in docs/AI_COSTS.md.
