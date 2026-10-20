# Inbox and contacts

The Inbox is one place for every conversation: the website chat today, and the Instagram and Facebook comments and DMs
of accounts that have "Answer comments and messages" switched on. The team reads, answers, writes notes only the team
sees, assigns conversations to each other and closes them. Contacts is the list of everyone who wrote, on any channel,
with their tags and custom details (size, district, budget...), their conversations, leads and automations.

**Pages:** `/dashboard/inbox` (one conversation: `?c=<id>`), `/dashboard/contacts`, `/dashboard/contacts/<id>`
**Plans:** feature key `inbox`: Business, Standard and Pro; an add-on for Starter (Rwanda seed price 5,000 RWF a month,
Admin → Add-on prices). Members answer and tag; Owners and Admins also import, merge, delete and manage fields and tags.

## What you see

- **Inbox, left:** the views Open, Mine, Unassigned, Closed and All, a search (name, phone, message), a channel filter,
  and the conversations, newest first: name, last message, channel, "n new", "Team answering" and who it is assigned to.
- **Inbox, right:** the conversation. At the top: the name (opens the contact), channel and account, the assign menu and
  Close/Reopen. Under it: whether automations can answer, with **Take over (pause 24 h)** or **Resume automations**, and
  the contact's tags (add or remove). Messages: theirs on the left; yours on the right (dark for the team, light blue for
  automations); comments, public replies and team notes are labelled; a message that could not be sent says why.
- **Write box:** **Reply** or **Note for the team**. Enter sends, Shift+Enter makes a new line.
- **Contacts:** search, tag and channel filters, Export CSV, Import CSV and **Tags and fields** (owners and admins), the
  table, and bulk actions for the ticked contacts (add or remove a tag, delete).
- **A contact:** details (name, phone, email, every custom field), "Agreed to receive news by email", tags, channels,
  conversations, leads and automation runs, and "Same person?" to merge duplicates.

## How to use it

1. Open **Inbox**. New conversations appear by themselves (the list refreshes every 15 seconds, an open conversation
   every 6 seconds).
2. Click a conversation and answer. Your reply goes out on the same channel (into the website chat bubble, or as an
   Instagram or Facebook DM). Replying pauses automations in that conversation for 12 hours, so they do not talk over you.
3. Need a colleague? Pick their name in the assign menu. Want to remember something? Switch to **Note for the team**.
4. Done? Click **Close**. If the person writes again, it opens by itself.
5. In **Contacts**, add fields in **Tags and fields** (for example "District", a choice with Gasabo, Kicukiro,
   Nyarugenge). Automations can ask for them and fill them in.
6. To bring in your existing customers, **Import CSV** with the columns `name, email, phone, tags` (tags separated by
   `;`) and any field key. A known email or phone updates that contact.

## Limits and settings

- Instagram, Facebook (and WhatsApp later) only allow replies within **24 hours** of the person's last message; after
  that the write box says so and the platform refuses the message.
- Import: up to 5,000 contacts (2 MB) per file, 10 imports an hour. Export: up to 10,000 contacts. Export and delete
  are allowed on any plan (the contacts are the company's own data).
- Up to 200 tags and 50 fields per company.
- Deleting a contact deletes their conversations and automation history; leads stay in Leads.

## For developers

| Part | Path |
|---|---|
| Pages | `app/dashboard/inbox/page.tsx`, `app/dashboard/contacts/page.tsx`, `app/dashboard/contacts/[id]/page.tsx` |
| Actions | `app/dashboard/inbox/actions.ts` (`loadThread`, `sendReply`, `saveNote`, `assignTo`, `changeStatus`, `pauseAutomations`, `tagContact`), `app/dashboard/contacts/actions.ts` (`saveContact`, `bulkTag`, `removeContacts`, `merge`, `importContacts`, `addField`, `removeField`, `changeTag`) |
| Components | `components/inbox/inbox-view.tsx`, `components/contacts/contacts-list.tsx`, `components/contacts/contact-detail.tsx` |
| Logic | `lib/inbox/` (`service.ts`, `ingest.ts`, `send.ts`, `website.ts`, `notify.ts`, `labels.ts`, `channels.ts`, `types.ts`), `lib/contacts/` (`core.ts`, `service.ts`, `csv-parse.ts`) |
| Database | `Contact`, `ContactIdentity`, `ContactTag`, `ContactTagLink`, `ContactField`, `Conversation`, `Message`, `Lead.contactId` (migration `20261025100000_conversations_engine`) |
| API routes | `GET /api/contacts/export` (CSV), `POST /api/widget/messages` (the chat bubble asks for new replies every 8 s while open) |
| Tests | `tests/automations/engine.db.test.ts` (inbox and website flow on the database), `tests/automations/templates.test.ts` (CSV) |
| Docs | [docs/INBOX.md](../../INBOX.md) |

The website chat: `lib/widget/chat.ts` stores each visitor message in the inbox (`ingestWebsiteMessage`) when the plan
has it. An automation's replies come back in the same answer; a teammate's reply is written into the chat session by
the website channel (`lib/inbox/channels/website.ts`) and the bubble (`public/widget-chat.js`) picks it up through
`/api/widget/messages`. The chat's own AI replies are copied into the conversation (`mirrorWebsiteReply`), and a lead
from the chat is linked to its contact (`linkLeadToContact`).

## If something goes wrong

| Symptom | Where to look | Usual fix |
|---|---|---|
| No website conversations in the Inbox | Is `inbox` in the plan (Admin → Plans)? Only chats after it was added are stored. | Add the feature; new chats appear. |
| A reply shows "Not sent: … 24 hours …" | The person wrote more than a day ago (Meta rule). | Wait for them to write again. |
| A reply shows "This channel is not switched on yet." | Admin → Services (Composio/Meta), the account's switch on Channels. | Switch the channel on. |
| The website visitor does not see the team's reply | The bubble only checks while it is open (10 minutes after the last activity). | Ask them to reopen the chat; check `/api/widget/messages` answers 200. |
| Import says "needs an email or a phone column" | The first row must name the columns. | Rename the columns `name, email, phone, tags`. |
