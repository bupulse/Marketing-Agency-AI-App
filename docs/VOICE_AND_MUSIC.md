# Voiceover and music

Owner decisions (13 October 2026): content videos get a spoken voiceover (ElevenLabs, paid plan) and background music
from a free, royalty-free library; their scenes are the AI people photos, animated (Ken Burns), never AI video clips.
Code: `lib/ai/tts.ts`, `lib/voice/`, `lib/music/`, `components/visuals/video-renderer.ts`, `lib/visuals/robot.ts`.

## Voiceover

- **Provider seam** (`lib/ai/tts.ts`): `TtsProvider` with `ElevenLabsProvider` (model `eleven_multilingual_v2`,
  `ELEVENLABS_MODEL` to change it). `ELEVENLABS_API_KEY` is read on the server only, sent only in the `xi-api-key`
  header and never logged; errors keep only the HTTP status. Without the key, videos have no voiceover. The admin
  console's Services page has an ElevenLabs switch (`elevenlabs` in `lib/admin/service-catalog.ts`): off, videos are
  made with captions and music only.
- **Voices** (`lib/voice/voices.ts`): JB Pro (`NZ8KtusXpnktPYja5Qko`, the default) and a few ElevenLabs voices, male
  and female. Content → Settings picks the company's voice and plays each voice's public sample (free). The list is
  code: to add African English voices from the ElevenLabs Voice Library, add their ids there (check them with
  "Listen" first).
- **What is spoken** (`lib/voice/speech.ts`): one sentence per scene, taken from the scene captions (the video plan
  already removed timestamps, labels and stage directions), each ended with a full stop.
- **When it is made**: just before a video is rendered, not when content is written: the owner's browser asks for it
  in `startVideoRender`, the video robot in its claim (`ensureVoiceover`, `lib/voice/service.ts`). So characters are
  only spent on videos that are actually made.
- **Timing**: ElevenLabs' "with timestamps" answer gives the time of every character. Each line's start and end set
  the scenes (`fitPlanToVoice`): a scene starts one crossfade before its line, so its caption appears as its words
  begin; the video ends 0.9 s after the last word, 10 to 30 seconds in all. Captions are therefore in time with the
  voice. If the text would take longer than about 29 seconds (15 characters a second), one cheap AI call shortens the
  lines first (`shortenLines`, ledger feature `voice`); a voice that still runs over 30 seconds is not used (note).
- **Reuse**: a voiceover is stored once per company, voice, model and text (`VoiceClip`, sha-256 hash; file
  `<userId>/voice/<hash>.mp3` in the private media bucket, counted toward the 500 items / 2 GB quota and the platform
  guard). Making the same video again costs nothing. "Regenerate voiceover" forgets the clip and speaks it again.
- **Billing and limits**: characters spoken are counted on `voiceCharacters` (`consumeUsage`, given back on any
  failure), the call goes through `withLedger` (provider `elevenlabs`, characters recorded as input tokens, priced at
  $0.30 per 1,000 in `lib/ai/pricing.ts`), so the platform cap and the company allowance apply. Out of characters, no
  plan feature, allowance used or the service off: the video is made without a voiceover and the panel says why.

| Plan | Voiceover characters a month |
| --- | --- |
| Rwanda Business, Pro | 5,000 (about 15 videos) |
| Free trial | 600 (its sample video) |
| Starter, Standard | 0: "Voiceover" add-on (RW 5,000 RWF a month, placeholder for the owner to confirm) |

`voice` is now a built feature (it needs `video`); an offer that adds it gives 5,000 characters
(`20261017100000_voice_and_music`).

## Music library

- **Storage**: a public-read Supabase bucket `music` (MP3 or M4A, 6 MB each, 80 MB for the whole library). Public
  because these are royalty-free tracks meant to be heard by anyone: the browser renderer and the video robot fetch
  them without signing, and nothing private is in there. Only the admin writes (signed upload URLs made with the
  service key; the bucket has no write policy). Not `/public`: the console uploads at run time and the deployed app's
  files are read-only.
- **Admin page** (`/admin/music`, the console's admin check with AAL2 on every action, audited): upload with title,
  1 to 4 moods (upbeat, calm, corporate, inspiring, afro / amapiano style, acoustic, warm, energetic), optional BPM,
  and the required licence name, https source page and credit line; play, activate or deactivate, remove. The file's
  first bytes are checked (ID3 or MPEG frame, or an M4A "ftyp" box); a bad file is deleted.
- **The library ships empty.** No music was downloaded: the owner approves a list first. Until then videos have no
  music ("The music library is empty for now" in the video panel).
- **Choice**: the art director names a mood for each post (`mood` in its answer); without one, the content pack angle
  or the brand voice decides (`moodFor`). `pickTrack` takes an active track with that mood, varied by video so the
  posts of a pack do not all share one; the owner can pick another track or "No music" in the video panel.
- **Credit lines**: a track's credit line shows under its video in the panel, and is added once at the end of the
  text of every post that carries that video (`withMusicCredit`), so licences that require attribution are met
  wherever the video is published. Tracks that need no credit can carry a plain credit too; nothing is hidden.

## Mixing (browser and robot, the same code)

`lib/voice/mix.ts` mixes at 44.1 kHz: the voice at full level from 0 s; the music looped if shorter, faded in over
1 s and out over the last 1.5 s, at 85% alone and ducked to 20% while someone speaks (`musicEnvelope`: 250 ms ramps,
lines less than half a second apart count as one stretch, so it does not pump). Clipped to [-1, 1], encoded to AAC
128 kbit/s and muxed into the MP4 (about 0.5 MB for 30 s: the 8 MB cap still holds). The WebM fallback (no
WebCodecs) has no sound; the panel says so.

The video robot's claim (`claimRobotVideos`) makes the voiceover, then hands out `audioUrls` (the signed voiceover,
only the owner's own file, and the public track); the robot downloads them like the photos (same storage origin only,
8 MB cap) and passes them to the page as data URLs, so robot videos sound exactly like browser videos.

## People in videos

The video plan's scenes use the content's people photo (the AI cover) for the opening scene and scenes without a photo
(`lendPhotoToVideo`), with the album photos for the rest, animated with the Ken Burns moves. No AI video clips.

## Tests

`tests/voice/speech.test.ts` (spoken text, timings, scene fitting, captions in sync, music envelope, mixing maths),
`tests/voice/service.test.ts` (charging, reuse, limits, failures, shortening, quota, owner choices),
`tests/voice/providers-and-music.test.ts` (ElevenLabs request and errors, previews, pricing, plans and add-on, music
uploads and choice, robot sound URLs and downloads).
