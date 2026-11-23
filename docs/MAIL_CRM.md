# BuPulse Mail + CRM

Two new BuPulse services, built inside this app (same code, same database, same login), served at
**mail.bupulse.com** and **crm.bupulse.com**. Owner decisions from the grill on 23 Nov 2026 are final unless the owner
changes them.

## Owner decisions (grill, 23 Nov 2026)

1. **Users:** the BuPulse team first (cyusa@, office@, support, sales). Designed so it can be sold to clients with their
   own domains later (phase 2), but phase 1 is for BuPulse itself.
2. **Mailboxes:** every address @bupulse.com. Named inboxes for cyusa@, office@, support@, sales@ (support@ and sales@
   are shared team inboxes for staff the admin allows), plus a catch-all "Other" inbox for every other @bupulse.com
   address, so nothing is lost. Admin can add more named mailboxes.
3. **Sign-in:** the same BuPulse login. Sign in at bupulse.com/login, open Mail or CRM from the service chooser (see
   the subdomain plan: one client sign-in, Marketing on marketing., Agency OS on agency.). Staff get Mail/CRM access
   from Admin.
4. **CRM first holds:** contacts and companies (phone, email, WhatsApp, notes, tags, and every Mail email on the
   contact); a deals pipeline (drag-and-drop stages such as New lead, Quote sent, Won/Lost, RWF amounts, expected
   close date); tasks and reminders (email/Telegram); today's leads (quote requests and contact messages from
   Admin → Sales flow in as leads); a calendar; bookings (a public booking link); email templates; bulk email sending.
   "All the CRM things": the agent proposes the rest from the teardown.
5. **Bulk email:** stay free. Resend's free plan sends 100 emails/day (3,000/month): big sends are queued in batches
   over days, with a progress bar, and every bulk email has an unsubscribe link and honours unsubscribes.
6. **Build and test:** inside BuPulse, on branch `mail-crm` in `~/BuPulse-mail`, check server on port 3006 (never 3001,
   3002 or 3100). Nothing goes live until the owner says "deploy it".

## Teardown first (design study, not copying)

The owner wants a great UI. Before building, write `docs/mail-crm/TEARDOWN.md`: a feature and UX teardown of **Gmail**
(for Mail) and **Insightly** (for CRM), from what any user can see: their public product pages, help docs, and the
screens as a user sees them. Cover layout, navigation, the flows (compose, reply, search, labels, pipeline, contact
page...), keyboard shortcuts, empty states, mobile. Then a section **"What BuPulse does better or simpler"**.

Rules: do NOT decompile, download or copy their code, bundles, icons, logos, illustrations or text, and do not use REA
on their products. Their code and designs belong to Google and Insightly; copying them would break their terms and
copyright. Our screens are our own design in the BuPulse look: real BuPulse logo, simple Apple-like, brand accents,
the support sidebar is the reference (memory: design-real-logo-apple).

## Mail (build first)

- **Receiving (free):** Cloudflare Email Routing for bupulse.com with an Email Worker that sends each message (raw MIME)
  to `POST /api/mail/inbound` on bupulse.com, signed with a secret. The app parses it, stores attachments in
  Supabase storage, threads it, and files it in the right mailbox (or the catch-all). No mail server on the PC: ISPs
  block port 25 and the tunnel carries only HTTP.
  - Turning on Email Routing replaces bupulse.com's MX records. **Show the owner the exact DNS changes and get an
    explicit OK before saving anything in Cloudflare.** Keep SPF correct for Resend.
- **Sending:** Resend (already used: `RESEND_API_KEY`, lib/lead-alerts/channels.ts), from the mailbox's address, with
  proper Reply-To/In-Reply-To/References so replies thread in other mail apps.
- **Order:** receive → inbox + threads → send/reply/forward → labels, stars, archive, trash, spam, search, drafts
  (autosave), attachments, signatures, undo send, keyboard shortcuts → mobile layout.
- Owner's first real use: the I&M bank and IremboPay emails from cyusa@bupulse.com (texts are in ~/BuPulse-company/emails).

## Mail console (owner, 23 Nov 2026, after the grill)

- **Sign-in:** the normal BuPulse login **plus the 6-digit authenticator code** (owner's choice, multiple choice): Mail
  holds bank emails.
- **Mail console** for mail admins (a user with role "Mail admin"; the owner always is): create users, each with their
  own @bupulse.com mailbox, a role (Member / Mail admin), the shared mailboxes they may use, a **storage allowance that
  admins raise or lower** (100 MB, 250 MB, 500 MB, 1 GB or custom), and an invite to a personal address.
- **Default signature:** one team template (`{name}`, `{title}`, `{phone}`, `{email}`, `{mailbox}`, the real BuPulse
  logo) filled in for **every user when they are created**; "apply to all users" updates existing ones; shared mailboxes
  sign as the team.
- **Forwarding:** rules "mail to X also goes to Y" (keep a copy or not, on/off). A @bupulse.com target is copied in the
  app; an outside target is forwarded by the Cloudflare Email Worker after Cloudflare confirms the address (free, not
  counted in the 100 daily sends). **Extra addresses** (info@ into support@) and the catch-all choice (Other inbox, or
  refuse later).
- **Storage honesty:** Supabase Free has 1 GB of file storage for the whole project; the console shows the pool,
  what is given out and what is used. Message text lives in the database (500 MB free). Paid upgrade path written down,
  not bought: Supabase Pro (100 GB).
- Design: the canvas "BuPulse Mail design" (claude.ai artifact, private to the owner) with the inbox, compose, phone
  screens and the console (users, create user, forwarding, signature).

## Second grill (owner, 23 Nov 2026): inboxes, departments, signatures, look

- **What each person sees:** only their own mailbox(es) plus mail an admin forwards to them. Forwarders are set **only in
  the Mail console**. Forwarded mail gets its **own folder per source** in the receiver's rail (e.g. "Grace") **and**
  shows in **All inboxes**, which combines everything with a "from <account>" tag. Clicking Cyusa / Office / Sales
  shows only mail sent to that address.
- **Staff notice:** an employee whose mail is forwarded sees a small note in their Settings ("Mail to grace@ is also
  delivered to cyusa@, set by your admin"), for Rwanda's 2021 data protection law.
- **Tags:** automatic tags (Bank, Payments, Leads, Partners, Updates...) and an Important mark from **free rules first**
  (sender domains and keywords), AI later (paid; ask first).
- **Departments:** every user is in a department; a department has a head (chosen when creating the user or in the
  console). In To, a **department** (or Everyone) can be picked: Mail sends **one personal email per member** with an
  automatic "Hello {first_name}," greeting, and {first_name} works anywhere; each copy is one of the 100 daily sends and
  a preview lists who gets it. **Owner + Mail admins** may pick any department; a **head** only their own; members type
  addresses one by one.
- **Signatures:** the default is the owner's reference layout (logo left, accent bar, name, "Title, BuPulse" in the
  accent colour, website | email | phone, address, LinkedIn / Instagram / Facebook, a "Get your free BuPulse quote"
  button). **5 templates**. Each employee, in Settings, picks a template and edits their own lines (name, job title,
  phone, one optional line); company parts (logo, website, address, the three company social links, the quote button)
  are edited **only in the Mail console**. Phone numbers are written like the quote form: `formatPhone`
  (libphonenumber international, "+250 788 191 802").
- **Attachments preview inside BuPulse only** (files never sent to another company): PDF, images, Word (.docx) and Excel
  (.xlsx) open in a preview window, then Download; PowerPoint and old .doc show "Download to open".
- **Look:** Gmail-like and lightly branded (the logo small, brand colour only as an accent), Apple.com principles
  (space, type, calm, motion with meaning), liquid glass panels, smooth animations. **Preloader:** the BuPulse logo with
  a pulse when Mail opens; opening an email plays a quick pulse line and a slide-in (about 0.3 s). **Backgrounds:** a
  gallery of about 12 plus each person's own photo (shrunk to about 300 KB, counts toward their storage).
- **Layout: Gmail-style** (owner, 23 Nov, after trying a dock layout: "bring back how it was, more like Gmail"): top bar
  (menu, small logo + "Mail", search pill, light/dark switch, Quick settings, services, avatar), left list (Compose,
  mailboxes with unread counts, "Forwarded to you" folders, folders, tags), one-line rows in a glass panel, and a
  **Quick settings** panel on the right (Appearance Light / Dark / Auto, background thumbnails, glass slider, "See all
  settings"). Our touches stay: "from" tags in All inboxes, forwarded folders, tags, glass, the preloader.
- **Light and dark mode** for every screen (Auto follows the device). Dark mode lays a soft dark layer over any
  background; the logo switches to the white version; tags and chips have dark variants.
- **Liquid glass clarity** set in the Mail console (Company and look): a Clear ↔ Frosted slider, a tint (Light, Dark,
  Blue), and "each person may change it in their own Settings". Text contrast always stays readable.
- **Phone = an Apple-style app** (iOS look): large titles, round glass buttons, inset grouped lists, iOS swipe actions
  (More / Flag / Archive), a floating glass bottom bar with Mailboxes, Search (with dictation) and Compose.
- **Picture backgrounds** (owner, 23 Nov): Kigali hills, Kigali at night, Lake Kivu beach, Virunga volcanoes (plus the
  gradients) and a **Random** choice that shows a new picture every day. The canvas uses original drawings; real photos
  only with a checked free licence (Unsplash/Pakutaso terms per photo; some Rwandan photos are not free to reuse) or
  photos the team takes.
- **Profile photos:** every person adds their photo during first sign-in (step 1 of 3: photo, signature, look): take
  or upload, zoom/move, made small (about 60 KB). Option to put the photo in their signature.
- **Senders' pictures in our inbox:** our team's photos, CRM contact photos, Gravatar, verified brand logos (BIMI), else
  the sender company's website icon, else initials. Gmail does not let other apps read its users' photos.
- **Our photos in Gmail (free):** each person makes a free Google account with their @bupulse.com address ("use my
  current email"; Google's code arrives in BuPulse Mail) and sets the same photo, visible to anyone. The first-sign-in
  screen guides them. Paid later (written down, not bought): BIMI company logo in Gmail needs DMARC enforcement plus a
  CMC (about $650–1,400/year) or a VMC with a registered trademark (blue check).
- **Attachment viewer:** a dark glass Quick Look-style window: page thumbnails, page arrows, zoom, Fit width / Fit page,
  rotate, find in document with highlights, print, details panel (type, size, sender, "safe preview"), Save to CRM,
  Download, and a strip to switch between the email's files; PDF, Word, Excel (sheet tabs) and photos.
- **Department mailboxes** (owner, 23 Nov): **support@ is visible to everyone, who may read and reply** ("Assign to me"
  prevents double answers). Each department sees its own department mailbox (sales@ for Sales, **accounting@** for
  Accounting...). **accounting@** is a shared mailbox for the Accounting department **plus automatic copies** of every
  Bank / Invoices / Payments / Receipts email that reaches any company mailbox (tag rules). Owner and Mail admins see all.
- **File previews, all inside BuPulse:** PDF and images in the browser; **Word, Excel, PowerPoint (new and old) through
  LibreOffice on the server** (free, installed once on the office PC; 2–10 s the first time, then cached); CSV as a
  table; SQLite databases (.db/.sqlite) read-only (tables list + rows, in the browser); code/text with colours;
  audio/video players; ZIP contents list; 3D: .glb/.gltf/.obj/.stl spin in the browser, **.blend converted by Blender on
  the server** (free, Blender installed on the office PC; info card + Download until then).
- **Phones in signatures** (owner, 23 Nov): the **company phone** is set once in the Mail console and is in **every**
  signature; staff cannot change or remove it. Each person may add a **personal (mobile) phone** in Settings or when the
  admin creates them; it shows as "Mobile" next to the company number. Both inputs look like the quote form's: a large
  field with the country picker (flag, +250, chevron) and the placeholder "720 123 456"; numbers are stored in E.164 and
  written with `formatPhone`.
- **Reading layouts:** split preview (list + reading pane, "Split") and **full screen** (one centred email, the sender's
  CRM card beside it, previous/next), switchable in the top bar.

## CRM (after Mail)

Linked to Mail from the start: every email to or from a contact shows on its page; "Add to CRM" from any email.
Then the scope from decision 4. The admin's existing Sales leads move into the CRM without losing data.

## Rules (from the owner's standing rules)

- Free services only. Ask before anything paid; keep a paid upgrade path written down, not bought.
- Database: develop against the TEST database. Migrations additive only. Production changes need a backup and the
  owner's "deploy it".
- No push to main, no deploy, no DNS or tunnel changes without the owner's explicit OK. Commit on `mail-crm`; when a
  phase is checked, tell the main session (bupulse-2c) so it can merge and put it on the test site.
- Secrets only in .env / Keychain / Admin; never printed, never in chat, never committed. Never print rows of
  TEST_ACCOUNTS.md (grep emails only).
- Ask the owner decisions as multiple choice (AskUserQuestion), one at a time. Subagents on Opus 5.5 or smaller, at
  most 2–3 at a time.
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- This Next.js has breaking changes: read the relevant guide in node_modules/next/dist/docs/ before writing code.
- Tests (vitest) for parsing, threading, routing, the inbound signature check, the bulk queue and unsubscribe.
