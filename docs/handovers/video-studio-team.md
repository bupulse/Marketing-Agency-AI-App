# Video Studio team brief (17 October 2026)

The owner (not a developer) is building **BuPulse Video Studio**: a site like seedance2ai.io and Higgsfield's
Marketing Studio that turns a Rwandan business's products, photos and offers into ready-to-post marketing videos.
Lead: Claude (Fable 5.1). Team agents run on smaller models with these roles. Read `docs/VIDEO_ENGINE.md` and
`docs/research/VIDEO_COMPETITORS_TEARDOWN.md` first.

## Owner decisions

- Real video (moving people) needs a video model: **Seedance 2.0 via BytePlus**. The key is not in yet
  (`SEEDANCE_API_KEY`); the studio must show what Seedance will produce and be ready the second the key arrives.
- **Claude specialises in 3D motion graphics**: animated and 3D-style clips from product photos, uploaded videos and
  generated images, with **ElevenLabs voice-overs** (`ELEVENLABS_API_KEY` is set; `lib/ai/tts.ts`, `lib/voice/*`) and
  **Gemini "Nano Banana" images** (`GEMINI_API_KEY` is set; `video-lab/influencers.ts` shows the call).
- 3D: the browser "3D look" first (depth, parallax, lighting, extruded text, turntables, particles) AND a Blender
  pipeline (free, on this Mac) for premium clips.
- The site copies seedance2ai.io: home, a page per model, AI image page (Nano Banana), showcase, pricing, guide, API
  page, language switcher EN / FR / RW. **Every button must work and go straight to its generator.**
- Research: an Instagram reels researcher (the owner logs in; notes only, no downloads) and a TikTok researcher (no
  login) build a database of the best marketing reels: hook, pacing, text on screen, caption, sound, why it works.
  A "brain" agent turns it into the engine's rules.
- Claude for tests runs on the owner's subscription (`video-lab/claude-cli.ts`). **Before any deploy, switch to the
  API key.**

## Hard rules for every agent

- Work only in `/Users/macbook1/BuPulse-video`, branch `video-engine`. Never push, merge, deploy or run
  `npm run release:zip`. Commit locally only when asked by the lead, with messages ending in
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `.env` points at the TEST Supabase project (rzlcizxnhtfqminqkphp). Never touch production. Never print, log or
  commit secrets; never print `TEST_ACCOUNTS.md` rows.
- Free services first. Approved paid: ElevenLabs, BytePlus Seedance (prepaid), Gemini images (about $0.04 each; keep
  tests to a handful). Anything else paid: stop and report.
- Browser research: behave like a person (3 to 8 s per video, no mass scrolling), never like, follow, comment,
  download videos or log in with any account; take notes and links only. Stop and report if a site shows a
  challenge, a block or a login wall.
- Next.js 16 is not the version you know: read `node_modules/next/dist/docs/` before any Next.js API. The studio
  itself is a standalone site (`video-lab/`, built by `scripts/video-lab/start.mjs`, run with `npm run lab`,
  http://localhost:3100); only one `npm run lab` may run at a time.
- Match the surrounding code: plain-English messages, comments where the code is not obvious, tests in `tests/`
  (vitest). Before reporting done: `npx tsc --noEmit -p .` (only your files must be clean; pre-existing errors in
  `.next/types/...` are known), `npx eslint <your paths>`, `npx vitest run tests/video-engine`.
- Stay in your files (listed in your task) so agents do not edit the same file at once. If you need a change in
  another agent's file, write it down in your report instead.
- Report in plain English: what exists, what you built, what you tested (real results), what is missing.

## Files by role

| Role | Owns |
| --- | --- |
| Site | `video-lab/site/**`, `video-lab/server.ts`, `video-lab/credits.ts`, `video-lab/influencers.ts`, `scripts/video-lab/start.mjs` |
| Motion engine | `lib/video-engine/**` (except `seedance*.ts`), `components/visuals/*` only if needed, `video-lab/voice.ts` (new), `tests/video-engine/**` |
| Seedance | `lib/video-engine/seedance*.ts`, `video-lab/seedance-jobs.ts`, `video-lab/seedance-mock/**` (new), `docs/VIDEO_ENGINE.md` Seedance sections |
| Research | `docs/research/reels/**` only |
| Brain | `lib/video-engine/brain/**` (new), `docs/research/BRAIN.md` |
| Blender | `tools/blender/**` (new), `docs/BLENDER.md` |

- Never stop processes by pattern (`pkill -f`, `killall`): on 17 October a `pkill -f cat` matched "Applications" and killed the owner's Chrome and the studio supervisor. Stop only your own process by its exact PID.
