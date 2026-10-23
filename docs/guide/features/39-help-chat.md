# Help chat (asking BuPulse for help)

The round blue chat button in the bottom-right corner is **BuPulse's own help chat**. Ask it anything about BuPulse:
how a page works, why a post did not go out, how to pay with Mobile Money. An AI that knows this whole guide answers in
seconds, day and night, and a person from the BuPulse team can join the chat at any time.

This is not the **Website chat** you put on *your* website for *your* customers
([11-website-chat.md](11-website-chat.md)). The help chat is BuPulse talking to you.

**Where:** on every page of bupulse.com, the dashboard and the creator portal. On a phone it sits just above the bar at
the bottom. On the public pages a smaller green **WhatsApp** button sits just above it; it hides while the chat is
open. **Who:** everybody, every plan, the free trial included. It costs nothing.

## Start a chat

1. Tap the chat button.
2. **Signed in?** You go straight to the chat. The AI already knows your business, your plan, your trial days and which
   channels are connected, so you don't have to explain. It can only *read* these; it never changes anything.
   **Not signed in?** Write your name, email and business name (and your WhatsApp number if you like), then tap
   **Start chatting**. If you already have an account, tap **Log in** under the form to skip it.
3. Type your question, or tap one of the suggestions.

The AI's answers say which part of the guide they come from ("from the guide: Billing, plans and usage"), and some have
a button that takes you to the right page (**Open Channels**, **See prices**).

## Talk to a person

- Tap **Talk to a person** under the AI's answer. The AI also brings in a person by itself when it isn't sure, when
  you seem upset, or for payments, refunds and account deletion.
- When someone joins, a line says **"Jean joined · the AI stepped back"**, and their name shows at the top of the
  chat. From then on only the person answers.
- The top of the chat shows the team hours, for example **team open until 20:00** (Kigali time). Outside those hours
  the AI keeps helping. If you need a person, it says when the team opens, and the team replies by email (or WhatsApp
  if you gave your number).
- **Continue on WhatsApp** (the green button at the top, and at the end of a chat) opens WhatsApp with BuPulse's
  support number.

## Photos, PDFs and voice notes

- **Paperclip:** send a screenshot, a photo (for example a Mobile Money receipt) or a PDF, up to 10 MB. Big photos are
  made smaller on your phone before sending, so they go fast on mobile data.
- **Microphone:** record a voice note of up to 2 minutes, in Kinyarwanda, French, Swahili or English. The team sees a
  written version too.
- Both work after your first message.

## The greeting

After a few seconds on a page (longer on Pricing and Sign up), a small **"Questions about plans?"** card may appear
above the button, once per visit. Close it with ✕ and it stays closed. It doesn't come back if you chatted in the last
7 days. On a phone there is only a red dot on the button, so nothing covers the page.

## Ending a chat

Tap **That's all, thanks**. Rate the chat with 👍 or 👎, add a comment if you like, and tick **Email me a copy** to get
the whole chat by email. **Start a new chat** begins a fresh one.

## Good to know

- On a slow or lost connection your messages wait and go out by themselves; the chat says **Reconnecting…** and keeps
  everything you wrote.
- The chat follows your light or dark theme.
- On a phone the chat fills the screen; the phone's **Back** button closes it.
- Your customers see a small **Made with BuPulse** link on your link-in-bio page. It opens this chat in "sales" mode, so
  people who like your page can ask BuPulse how to get one. Questions meant for *your* business are sent back to your
  own WhatsApp and call buttons.
- What the chat records and for how long is in the [privacy policy](https://bupulse.com/privacy#support-chat), section 13.

## For developers

| | |
| --- | --- |
| Spec | `docs/SUPPORT_CHAT.md` (section 10 is the visitor chat) |
| Mount | `components/support-chat/mount.tsx` in `app/layout.tsx`; where it shows: `lib/support/client/mount.ts` `chatSurface` |
| Chat | `components/support-chat/widget.tsx` (button, greeting, panel), `use-support-chat.ts` (visit, messages, outbox, real time, polling, heartbeats), `messages.tsx`, `composer.tsx`, `prechat-form.tsx`, `end-screen.tsx`, `media.ts` (photo shrink, voice recorder, Turnstile) |
| Logic | `lib/support/client/`: `api.ts` (client for `/api/support/v1`), `greeting.ts`, `outbox.ts`, `uploads.ts`, `paths.ts`, `prechat.ts`, `storage.ts`, `copy.ts` (every word), `mock.ts` (tests only) |
| Bio link | `lib/bio/page.ts` (`.made` corner link) → `app/help-chat/page.tsx` |
| API | `/api/support/v1` (`docs/api/support-v1.md`); an email link to `/?help=open` opens the chat |
| Tests | `tests/support-widget/` |

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| No chat button anywhere | `POST /api/support/v1/visit` fails (the button hides when the chat can't start) | Check the API and Admin → Errors |
| No chat button on one page | `chatSurface` excludes it (Admin, support app, bio pages) | Expected |
| Messages say "Reconnecting…" for long | The visitor is offline, or the API answers 5xx | Messages go out by themselves once it answers |
| Greeting never shows | Chatted in the last 7 days, already shown this visit, came from an ad (first page), or a phone (dot only) | Expected; test in a private window |
| Paperclip and microphone are grey | No conversation yet | Send a first message |
| Microphone does nothing | The browser blocked it ("Your browser did not allow the microphone") | Allow the microphone in the browser's site settings |
