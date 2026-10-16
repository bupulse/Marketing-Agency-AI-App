# Handover: video engine map (16 October 2026)

Read first: docs/VIDEO_ENGINE.md (the engine and the lab), docs/research/VIDEO_COMPETITORS_TEARDOWN.md (how
seedance2ai.io and Higgsfield work, BytePlus Seedance facts), docs/CONTENT_VISUALS.md and docs/VOICE_AND_MUSIC.md
(today's slideshow videos, voice and music), docs/VIDEO_ROBOT.md.

## Owner decisions so far

- **Main engine: Claude-designed** (Sonnet). Seedance is the backup and premium engine, for shots that need real moving
  people.
- **Test in a separate local lab:** `npm run lab`, http://localhost:3100, TEST database only, $5 a day.
- **Seedance avatars:** from the BytePlus digital-character library.
- **Test photos:** from the test database's products.
- **Colours:** BuPulse brand colours in the lab (Pulse Blue #2f6bff, Pulse Violet #7b5cff, Ink #0b0b0f).

## State

- **Done:**
  - the engine (spec, checking, renderer, MP4 with music, Claude designer, styles and hooks, a free sample);
  - the lab;
  - 26 tests;
  - checked in Chrome: the sample renders with photos and saves a 12 s MP4 with sound (5.3 MB).
- **Waiting:**
  - `ANTHROPIC_API_KEY`: empty in `.env` and not saved in the TEST Admin, Services, so no Claude design has run yet;
  - the BytePlus key (`SEEDANCE_API_KEY`) and the digital-character library.
- **Next:**
  1. Run the first real designs and record the measured costs.
  2. Tune the prompt and styles on what comes out.
  3. Add voice-over from `say` lines.
  4. Add Seedance tasks in the lab.
  5. Then wire it into the app ("Make a video", Autopilot, robot, quotas, guide).
