# The BuPulse guide

This is the complete guide to BuPulse: how to install it, how to put it online, how clients and staff use every page,
and, for each feature, where its code is and where to look first when something goes wrong. Every page has two parts:
plain steps for the owner first, then **For developers** with the files, functions and database tables behind it.

Screenshots and clips come from the real app on the test site (TEST database, the test business "Nova Phones Kigali"
on the Business plan, plus Urugo Homes on a trial and Inzu Fashion, which has not started its trial yet). All businesses, people and
numbers in them are made up.

**On this page**
- [Start here](#start-here)
- [Install and run](#install-and-run)
- [Client features](#client-features)
- [Admin console](#admin-console)
- [Demo videos](#demo-videos)
- [Finding your way in the code](#finding-your-way-in-the-code)
- [Keeping this guide up to date](#keeping-this-guide-up-to-date)

## Start here

| I want to… | Go to |
|---|---|
| Run BuPulse on a new computer | [Install: run on a new computer](install/01-run-on-a-new-computer.md) |
| Put BuPulse online, or prepare deploy day | [Install: put it online](install/02-put-it-online.md) |
| Install an update zip in Admin → Updates | [Install: update zip](install/03-install-an-update-zip.md) |
| Help a client get started | [Install: client setup](install/04-client-setup.md) |
| Understand a page a client sees | [Client features](features/README.md) |
| Fix something that is broken | [Troubleshooting](troubleshooting.md) |
| Find the code for a page or feature | [Code map](code-map.md) |

## Install and run

1. [Run on a new computer](install/01-run-on-a-new-computer.md): Node, the code, the `.env` keys, the database, starting it.
2. [Put it online](install/02-put-it-online.md): Cloudflare or Netlify, migrations, cron jobs, and the deploy-day checklist.
3. [Install an update zip](install/03-install-an-update-zip.md): the signed release zips in Admin → Updates, and rolling back.
4. [Client setup](install/04-client-setup.md): sign-up, onboarding, paying, connecting social accounts, the website chat.

## Client features

One page per feature, from the dashboard home to billing: [the full list](features/README.md).

<video src="videos/tour-dashboard.webm" controls muted width="100%"></video>

[Watch the dashboard tour](videos/tour-dashboard.webm) (silent, about 30 seconds).

## Admin console

The admin part (Overview, Clients, Payments, Plans, Services, Jarvis and the rest) is added once the owner has signed
in for the screenshots: the console needs the owner's emailed code and authenticator code, which the capture script
never enters. Until then, [the code map](code-map.md) lists where each admin page lives, and
[docs/ADMIN.md](../ADMIN.md) and [docs/JARVIS.md](../JARVIS.md) describe them.

## Demo videos

The 24 narrated demo videos (made for sales and social media) are kept on the owner's Mac, outside git, in `Demo/`:

| Video | Landscape (16:9) | Vertical (9:16) |
|---|---|---|
| Full walkthrough, long (in-person demos) | `Demo/Full walkthrough/BuPulse full walkthrough - long, for in-person demos (landscape 16x9).mp4` | same, `(vertical 9x16)` |
| Full walkthrough, short (social media) | `Demo/Full walkthrough/BuPulse full walkthrough - short, for social media (landscape 16x9).mp4` | same, `(vertical 9x16)` |
| 1 Intro | `Demo/Social media/1 Intro (landscape 16x9).mp4` and `Demo/In-person demo/1 Intro (landscape 16x9).mp4` | `(vertical 9x16)` |
| 2 Starter plan, Inzu Fashion | `Demo/…/2 Starter plan - Inzu Fashion (landscape 16x9).mp4` | `(vertical 9x16)` |
| 3 Business plan, Urugo Homes | `Demo/…/3 Business plan - Urugo Homes (landscape 16x9).mp4` | `(vertical 9x16)` |
| 4 Custom plan, Nova Phones Kigali | `Demo/…/4 Custom plan - Nova Phones Kigali (landscape 16x9).mp4` | `(vertical 9x16)` |
| 5 Paying by card | `Demo/…/5 Paying by card (landscape 16x9).mp4` | `(vertical 9x16)` |

"Social media" versions are shorter; "In-person demo" versions are slower, for showing someone face to face. The
videos are made with Remotion in `Demo/studio` (storyboard: `Demo/STORYBOARD.md`, screens: `Demo/capture`).

## Finding your way in the code

- [Code map](code-map.md): every folder, the conventions, and the rule that turns a URL into a file.
- [Troubleshooting](troubleshooting.md): symptom → where to look → fix.
- Each feature page ends with **For developers** (files, key functions, tables, tests) and **If something goes wrong**.
- The deeper design notes stay in [`docs/`](../): one file per area (BILLING.md, CONTENT.md, WIDGET.md, …).

## Keeping this guide up to date

- The screenshots and clips are made by `scripts/docs/capture-guide.mjs`. With the app running on the TEST database
  (`npx next start -p 3001`), run `node scripts/docs/capture-guide.mjs` (or `--only=client`, `--only=clips`, …). It
  signs in with the test accounts, only opens pages and scrolls, and never saves anything. Images land in
  `docs/guide/images/`, clips in `docs/guide/videos/`, and `docs/guide/images/manifest.json` says what each one shows.
- When a page moves or a function is renamed, search this folder for the old path (`grep -rn "old/path" docs/guide`).
