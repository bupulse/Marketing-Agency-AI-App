# Viral library

The Video Studio's library of viral short videos: what went viral on TikTok, Instagram Reels, Facebook and YouTube
Shorts, saved with its caption, numbers, still frames and a breakdown of how it was made, so BuPulse's engines can
learn from it and the owner can browse it at `/viral` in the studio (localhost:3100/viral, video.bupulse.com/viral).

Owner decisions (19 October 2026): save the link, frames and text (no video downloads); show it on a studio page;
Rwanda and East Africa first; 100 videos per platform in the first round.

## Where things are saved

| What | Where | In git |
| --- | --- | --- |
| One row per video | `docs/research/viral/<platform>.jsonl` (`tiktok`, `instagram`, `facebook`, `youtube`) | yes |
| What the round taught | `docs/research/viral/<platform>-notes.md` | yes |
| Still frames | `video-lab/data/viral/frames/<platform>/<id>/f1.jpg` … `f8.jpg` | no (local only) |

Frames are screenshots of other people's videos: they stay on this Mac and are never committed or published.

## What counts as viral

Keep a video when at least one is true, and write which in `viral_basis`:
- views (or plays) at least **10 times the account's followers**;
- East Africa: at least **100,000 views**, or at least **5,000 likes**, or at least **300 comments**;
- global: at least **1,000,000 views** or **50,000 likes**;
- Facebook ads (no view counts): running **30 days or more** with **5 or more live versions** of the same ad.

Mix per platform for round 1 (100 rows): about **70 East African** (Rwanda first, then Kenya, Uganda, Tanzania,
Burundi, DRC) and about **30 global business videos** (shops, services, brands, product ads) for ideas. Business and
product content comes first; a creator's viral video counts when a business could copy its format.

## One row (JSON Lines, one object per line)

```json
{
  "id": "vt-tt-001",
  "platform": "tiktok",
  "url": "https://www.tiktok.com/@account/video/7400000000000000000",
  "embed_url": "https://www.tiktok.com/embed/v2/7400000000000000000",
  "account": "@account", "account_name": "Shop name", "followers": 12000, "verified": false,
  "country": "RW", "city": "Kigali", "language": "rw", "language_mix": "rw+en",
  "sector": "phone-shop", "kind": "business",
  "is_ad": false, "posted": "2026-09-30", "captured_at": "2026-10-19T10:00:00Z",
  "duration_s": 18,
  "views": 1200000, "likes": 85000, "comments": 1300, "shares": 4200, "saves": 9000,
  "viral_ratio": 100, "viral_basis": "views 100x followers",
  "caption": "verbatim caption, line breaks kept as \n",
  "hashtags": ["kigali", "rwanda"],
  "sound": { "name": "original sound - account", "original": true, "kind": "voice" },
  "hook_text": "words on screen or said in the first 3 s",
  "hook_type": "price-first",
  "first_3s": "what the viewer sees and hears in the first 3 seconds",
  "structure": [
    { "from": 0, "to": 3, "beat": "hook", "what": "phone held to camera, price in yellow" },
    { "from": 3, "to": 12, "beat": "demo", "what": "three features, one cut each" },
    { "from": 12, "to": 18, "beat": "cta", "what": "WhatsApp number, shop sign" }
  ],
  "cuts_per_10s": 5, "camera": "handheld selfie", "visual_style": "shop floor, natural light",
  "on_screen_text": ["420K", "WhatsApp 0788 …"], "text_style": "white bold with black outline, middle of frame",
  "voice": "owner talking to camera, Kinyarwanda", "music_mood": "afro, mid-tempo",
  "price_shown": true, "phone_shown": true, "location_shown": false, "cta": "Call or WhatsApp",
  "format": "price-banner",
  "why_viral": "one or two sentences, what made people stop, share and comment",
  "lesson_for_engine": "one sentence BuPulse's engines can apply",
  "top_comments": [{ "text": "Angahe?", "likes": 40, "category": "price-question" }],
  "frames": ["video-lab/data/viral/frames/tiktok/vt-tt-001/f1.jpg"],
  "watched": true, "scam": false, "notes": ""
}
```

Rules for the fields:
- `id`: `vt-tt-`, `vt-ig-`, `vt-fb-`, `vt-yt-` plus three digits, never reused.
- Unknown numbers are `null`, never guessed. Counts as the platform shows them ("1.2M" becomes 1200000).
- `caption` is verbatim, with emoji and line breaks. `hashtags` without `#`.
- `country`: two-letter code; `null` when not clear (never guess from one hashtag).
- `sector`: one of the Brain's sectors where it fits (`lib/video-engine/brain/data/sectors.json`), else a short word.
- `kind`: `business`, `brand`, `creator` or `news`.
- `format` and `hook_type`: the Brain's ids where one fits (`lib/video-engine/brain/data/formats.json`,
  `hooks.json`), else a short new name.
- `top_comments`: up to 5, text only, no commenter names; `@mentions` become `@[user]`.
- `frames`: 6 to 8 JPEGs, 540 px wide, spread over the video (first one at 0.5 s), named `f1.jpg` upward.
- `embed_url`: TikTok `https://www.tiktok.com/embed/v2/<videoId>`; Instagram `https://www.instagram.com/reel/<code>/embed`;
  YouTube `https://www.youtube.com/embed/<videoId>`; Facebook
  `https://www.facebook.com/plugins/video.php?href=<url-encoded post url>`; `null` when there is none (ads).

## House rules for the collecting agents

- Use exactly one tab of your own in the research Chrome (DevTools port 9334) and reuse it for every page; never touch
  the owner's or other agents' tabs. At most two collectors browse at the same time; the lead says who.
- Scrolling is encouraged (owner, 19 October): besides searches, scroll the platform's own feeds (TikTok For You,
  Instagram Reels and Explore, Facebook Reels and Watch, YouTube Shorts) to find more viral videos, and watch each
  one you keep all the way through (muted) so the breakdown describes the whole video, not the first seconds.
  Scroll at a human pace (a few seconds per video, longer on the ones you study).
- Watch muted. Never like, follow, comment, save, share or message. Never download video files: frames are
  screenshots of the playing video.
- If a login page, a captcha or a "suspicious activity" notice appears: stop, do not solve it, report to the lead.
- Batches of 8 or fewer searches or pages; pause between batches. A crashed tab: open a new one.
- Skip scams and income claims ("earn X a day", MoMo screenshots, akayabo chains), adult content, anything with
  children as the subject, hate or political campaigning.
- Keep your scripts and working files in your own subfolder of the scratchpad (`scratchpad/tt/`, `ig/`, `fb/`, `yt/`):
  the scratchpad root is shared and other agents overwrite files there.
- Stop only your own processes, by their exact PID. Never `pkill -f` or `killall`.
- Write rows as you go (append to the JSONL; one valid JSON object per line). Never commit; the lead commits.
