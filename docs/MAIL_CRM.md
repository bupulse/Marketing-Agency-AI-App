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
