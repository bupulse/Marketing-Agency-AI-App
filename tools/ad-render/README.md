# Ad renderer (the Ad Brain's editor)

Turns an Ad Brain EDL (`lib/ad-brain/edl.ts`) into the finished 30 s MP4: frames drawn with Pillow and numpy, piped
into ffmpeg (H.264, 720x1280, 24 fps), with the sound mixed in numpy. The sound is:
- voice lines placed on the timeline, with a robot voice where asked
- the music's built drop, ducked under every word
- synthesised sound effects (no sound files to license)

The effects are ported from the 10 November 2026 prototypes (`~/bupulse-ugc-ads/twist/render_twist.py`, judged 9/10;
`story/render_story.py`, 8/10). The effect ids match `lib/ad-brain/effects.ts`, and
`tests/ad-brain/effects.test.ts` checks that both lists agree.

## Why Python, and where it runs

The Node server starts it as **its own process** (`lib/ad-brain/render.ts`), so a 25 s to 3 minute render never blocks
the web server. The prototypes that scored best were Python and Pillow, so porting kept their look exactly.

It runs on **the computer that serves bupulse.com** (today the self-hosted Windows PC, `docs/SELF_HOST.md`). It cannot
run on Netlify or Cloudflare Workers, which have no Python, no ffmpeg and no long-running processes. There, the Ad
Brain's steps stop at "Editing" with a message.

## What it needs

| Need | Windows PC (PowerShell, as the server's user) | macOS |
|---|---|---|
| Python 3.9 or newer | `winget install Python.Python.3.12` | built in (`python3`) |
| Pillow and numpy | `python -m pip install -r tools\ad-render\requirements.txt` | `python3 -m pip install -r tools/ad-render/requirements.txt` |
| ffmpeg and ffprobe | `winget install Gyan.FFmpeg` | `brew install ffmpeg` |
| Fonts: Arial Black, Arial Bold, Courier New Bold, Impact | already in `C:\Windows\Fonts` | already in `/System/Library/Fonts/Supplemental` |

Optional settings, read from the server's environment:

| Setting | What it is for |
|---|---|
| `AD_RENDER_PYTHON` | The Python command or full path. The default is `python` on Windows and `python3` elsewhere. |
| `AD_RENDER_FFMPEG`, `AD_RENDER_FFPROBE` | Full paths, when they are not on the PATH. |
| `AD_RENDER_FONTS` | A folder holding the four fonts, on Linux. |
| `AD_BRAIN_WORK_DIR` | Where each ad's files, frames and logs go. The default is `<temp>/bupulse-ad-brain/<job id>`, about 100 MB per ad, safe to delete once the ad is Ready. |

Check an install: `python tools/ad-render/render.py selftest`. It prints the Python version, the fonts found, ffmpeg's
version and the effects it can draw.

## Commands

```
python render.py render  <job.json> <out.mp4>      # the whole ad; <out.mp4>.json holds the result or the error
python render.py frames  <job.json> <dir> 1.0 6.4  # single frames as JPEGs (contact sheets)
python render.py analyze <music.mp3>               # {"seconds", "bpm", "firstBeat"} for the planner's beat grid
python render.py selftest
```

`job.json`: `{ "edl": <EDL>, "files": { "<asset key>": "<local path>" }, "logo": "<path>", "host": "bupulse.com",
"workDir": "<folder>" }`. The Node side downloads every asset into the work folder first.

## Timing

On the M-series Mac, the 30 s twist ad renders in about **25 s** (720 frames, about 10 MB). Expect 1 to 3 minutes on a
slower PC.

## Files

| File | What it holds |
|---|---|
| `render.py` | The command line, the frame composer (segments, transitions, titles, captions, beat pulse) and the encoder pipe. |
| `adr/core.py` | Canvas, fonts, easing, clip frames (extracted once per clip with ffmpeg), the tech background. |
| `adr/fx.py` | Segment effects, transitions and the real-screen presentations (browser window, phone-filmed monitor, tap ripple). |
| `adr/text.py` | Title styles (slam, typewriter, pop), captions (word-by-word, one-word), floating screen cards, the end card. |
| `adr/audio.py` | Decoding, voice levelling, robot voice, synthesised sound effects, music drop, ducking, tempo analysis, the mix. |
