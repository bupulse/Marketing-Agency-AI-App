# Seedance key day

What to do the day the BytePlus key arrives, in order. Each step says what you should see. Everything was checked
against the BytePlus ModelArk documentation on 17 October 2026 (details: `docs/VIDEO_ENGINE.md`, "What Seedance 2.0
takes"). Never paste a key into a chat, an email or a screenshot.

## The steps

1. **Make sure the account can switch Seedance on.** In console.byteplus.com, ModelArk activates Seedance 2.0 only
   with one of these:
   - a balance over USD 30;
   - an AI Savings Plan of USD 30 or more;
   - a Seedance resource pack with quota left (our prepaid pack).

2. **Choose the region.** In ModelArk, pick **Asia Pacific (ap-southeast-1)** at the top. The key and the models must
   both be in this region.

3. **Activate the three models.** ModelArk, Model activation: find these three and activate each one.

   | Name in the console | Model id the studio sends | Studio name |
   | --- | --- | --- |
   | Dreamina Seedance 2.0 | `dreamina-seedance-2-0-260128` | Pro |
   | Dreamina Seedance 2.0 fast | `dreamina-seedance-2-0-fast-260128` | Fast |
   | Dreamina Seedance 2.0 mini | `dreamina-seedance-2-0-mini-260615` | Mini |

4. **Create the key.** ModelArk, API keys, Create API Key. Copy it once and keep it safe.

5. **Paste the key in two places.**
   - **The app:** Admin → Services → "Seedance 2.0 (BytePlus ModelArk)" → `SEEDANCE_API_KEY`. Save, then press the
     service's **Test** button: it should say "BytePlus ModelArk accepted the key (video tasks list)".
   - **The Video Studio on this computer:** open `/Users/macbook1/BuPulse-video/.env` and add one line, with no
     quotes and no spaces: `SEEDANCE_API_KEY=<the key>`. (The studio can also read the key saved in Admin →
     Services, but only when `.env` has none and both use the same `ENCRYPTION_KEY`; `.env` is the sure way.)

6. **Check the connection (free).** In Terminal, in `/Users/macbook1/BuPulse-video`:
   `node --env-file=.env scripts/video-lab/seedance-check.mjs`
   - **Good result:** `Result: connected` and "Connected to BytePlus ModelArk (0 video tasks so far)".
   - **Anything else:** see "What the messages mean" below.
   - **Optional, also free:** add `--dry` to see exactly what a request will send, without sending it.

7. **Make the first real clip.**
   `node --env-file=.env scripts/video-lab/seedance-check.mjs --make-clip`
   - **What it makes:** a 4-second, 480p, vertical clip of a white mug, with sound, on Seedance 2.0 Mini.
   - **What it costs:** about **USD 0.14 of BytePlus credit (about 200 RWF)**. For comparison, the same clip costs a
     client **45 studio credits (450 RWF)**: the provider cost × 2.2, rounded to 5 credits (`video-lab/credits.ts`).
   - **Good result:**
     - the status goes queued → running → succeeded, usually within 1 to 4 minutes;
     - it ends with "Seedance works. N tokens, real cost $0.1…" and "Saved: video-lab/data/seedance/videos/check-….mp4";
     - opening that file shows a short mug shot that moves, with sound.
   - **Cost record:** the real cost is written to the lab's ledger. The daily cap ($5) still applies.

8. **Choose the presenters (digital characters).** BytePlus refuses photos of real faces, so presenters come from its
   Digital Character Library.
   - **Open the library:** in the ModelArk **Model Playground**, open the **Digital Character Library** tab below the
     input box. The first time, accept the agreement.
   - **Choose:** search or filter by gender, age and nationality, and open each character you like.
   - **Copy its asset ID:** it is shown on the character's page.
   - **Save them** in `video-lab/data/seedance-characters.json`, like this:
     `[{ "id": "the asset id", "name": "Amani", "description": "warm, for shops and reviews" }]`
   - **Optional:** BytePlus can also list the account's own characters automatically. That needs a separate Access
     Key (IAM, not the API key) in `.env`: `BYTEPLUS_ACCESS_KEY_ID=` and `BYTEPLUS_SECRET_ACCESS_KEY=`.

9. **Switch previews off: restart the studio.** Stop `npm run lab` (Ctrl+C) and start it again; keys are read when
   it starts. Previews then stop by themselves. There is no other switch:
   - **Create page:** pressing Generate on a Seedance video now says "Sending to Seedance…" instead of "Making the free
     preview…", and takes credits.
   - **Characters:** the six preview characters (Amani, Kalisa, Nadia, Shema, Imena, Rukundo) disappear; your
     characters from step 8 show instead.
   - **What stays:** earlier previews stay in "My videos" as previews, and the "Get inspired" examples stay storyboards
     (they are examples, not jobs).
   - **In the app:** Admin → Services → Seedance must be switched on (it can be paused there at any time).

10. **Optional, for video references (edit and extend).** BytePlus downloads reference videos from the internet. They
    work only while the video.bupulse.com tunnel runs and `.env` has `STUDIO_PUBLIC_URL=https://video.bupulse.com`.
    Photos, cut-outs and characters work without it.

## What the messages mean

| You see | What it means | What to do |
| --- | --- | --- |
| `no key` | `SEEDANCE_API_KEY` is not in `.env` | Step 5, then run the command again with `--env-file=.env` |
| `key invalid` (BytePlus: 401 AuthenticationError) | The key is mistyped, cut short, or from another region | Copy it again from ModelArk, API keys (ap-southeast-1); no spaces or quotes |
| `not activated`, "Seedance 2.0 is not activated" | The key works but the models are off (ModelNotOpen or AccessDenied) | Step 3; check step 1 if it will not activate |
| `not activated`, "no balance or is overdue" | The prepaid pack or balance is used up | Top up or buy a resource pack, then run again |
| `unreachable`, "did not answer" | No internet, or BytePlus is down | Check the connection; try again in a few minutes |
| `unreachable`, "this address is not the ModelArk API" | `SEEDANCE_BASE_URL` in `.env` is wrong | Remove that line (the default is right) |
| `connected`, "busy right now" | Too many requests this minute (429) | Wait a minute |
| "BytePlus declined the content" | Its content rules: usually a real person's face in a photo | Use a digital character (step 8) and product photos only |
| "The BytePlus balance or prepaid pack is used up" | No credit left | Top up |
| "Seedance did not finish within the hour" | BytePlus ended the task; nothing is billed and the studio gave the credits back | Try again; if it repeats, try Fast or Mini |
| "Still not ready after 15 minutes" (the check command only) | BytePlus is slow today; the task continues | Look for it in the ModelArk console, or run again later |

If something else appears, copy the message (not the key) and ask Claude.
