# Mail + CRM teardown: Gmail and Insightly (design study)

Written 23 Nov 2026 for docs/MAIL_CRM.md. This is a study of **what any user sees and does**, drawn from the public
product pages, the public help centres and ordinary use of the products as a user. Nothing was decompiled, downloaded
or copied: no code, bundles, icons, logos, illustrations or help text. Words below are our own descriptions. BuPulse's
screens are our own design in the BuPulse look (real BuPulse logo, simple Apple-like, brand blue→violet as accents, the
support app's left rail as the reference sidebar).

---

## Part 1. Gmail (reference for BuPulse Mail)

### 1.1 Layout

- **Three zones.** A top bar (product mark, one big search field with a filter button, help/settings/apps/account on
  the right), a left rail (Compose button on top, then system folders, then labels), and the main area (message list,
  or one conversation).
- **Left rail:** Inbox (with an unread count), Starred, Snoozed, Sent, Drafts (count), then "More" folding away
  Important, Scheduled, All Mail, Spam, Trash, Categories; then user labels as a nested tree, each with an optional
  colour dot. The rail collapses to icons only (hamburger).
- **Message list row:** checkbox, star, (importance marker), sender name(s) with a count when a thread has several
  messages ("Ana, me 3"), subject in bold when unread, then a grey snippet of the first line, label chips, a paperclip
  or attachment chips, the date on the right (time today, "12 Nov" this year, full date older). Hover swaps the date for
  quick actions: archive, delete, mark read/unread, snooze.
- **Bulk toolbar** above the list: select-all checkbox (with All/None/Read/Unread/Starred menu), refresh, more; once
  something is selected it turns into archive, report spam, delete, mark read, move to, labels, snooze. "Select all
  1,234 conversations in Inbox" appears after selecting a full page.
- **Pagination** "1–50 of 2,345" with older/newer arrows, not infinite scroll.
- **Density** setting (default / comfortable / compact) and an optional reading pane (right of or below the list).
- **Inbox types**: default with tabs (Primary, Promotions, Social, Updates, Forums), Important first, Unread first,
  Starred first, Priority, multiple inboxes. Tabs are automatic classification.

### 1.2 Conversation view

- Subject as a large title at the top with its label chips, print and "open in new window" on the right.
- Messages stacked as cards; older read ones collapse to one line (sender + snippet + date). A run of many collapsed
  messages folds into a single "N older messages" circle.
- Each expanded message: avatar, sender name and address, "to me" with a details caret (from/to/cc/date/mailed-by/
  signed-by/security), date, star, reply arrow, more menu (reply all, forward, filter messages like this, print,
  delete, block sender, report spam/phishing, show original, translate, download message, mark unread from here).
- Quoted text from earlier replies hidden behind a "…" button. Attachments as thumbnails/cards under the body with
  download and "save to Drive".
- At the bottom: Reply, Reply all, Forward buttons; smart reply suggestion chips above them.
- Toolbar above the conversation: back to list, archive, spam, delete, mark unread, snooze, add to tasks, move to,
  labels, more; "3 of 1,203" with previous/next arrows.

### 1.3 Compose

- A floating window docked bottom-right (several can stack side by side), can minimise to a title bar, expand to
  full-screen, or pop out. A reply opens inline under the conversation and can be popped out.
- Fields: From (dropdown when the user has several send-as addresses), To with contact autocomplete and chips, Cc/Bcc
  links that reveal fields, Subject, body.
- Bottom bar: Send (with a caret for "schedule send"), formatting toggle (bold, italic, underline, font, size, colour,
  align, lists, indent, quote, strikethrough, clear formatting), attach file, insert link, emoji, insert from Drive,
  insert photo, confidential mode, signature picker, more (templates, plain-text mode, print, check spelling), discard.
- **Drafts autosave** every few seconds ("Saved to Drafts" note).
- **Undo send**: after Send a toast "Message sent. Undo / View message" for 5–30 seconds (setting).
- **Signatures**: several named signatures, a default for new mail and for replies, placed above or below quotes.
- **Templates**: saved bodies inserted from the compose "more" menu.
- **Large attachments** over 25 MB become cloud links automatically.

### 1.4 Search

- Search field filters as you type with suggestions (people, recent searches, matching messages).
- A filter dropdown builds a query: From, To, Subject, Has the words, Doesn't have, Size, Date within, Search in
  (folder/label), Has attachment, Don't include chats. "Create filter" from the same form.
- Query operators any user can type: `from:`, `to:`, `subject:`, `label:`, `has:attachment`, `is:unread`,
  `is:starred`, `in:spam`, `before:`, `after:`, `older_than:`, `filename:`, quotes for exact phrases, `-` to exclude,
  `OR`.
- Search chips under the field (From, Any time, Has attachment, To, Is unread) refine without typing operators.

### 1.5 Organising

- **Labels, not folders.** A thread can have many labels; "Move to" = add a label and archive. Nested labels with a
  slash. Colours per label. Labels shown/hidden in the rail and in the list.
- **Archive** removes from Inbox but keeps in All Mail; it reappears in Inbox when someone replies.
- **Star** (with optional multiple star types), **Important** markers.
- **Snooze** to a time; the thread returns to the top of Inbox then.
- **Spam** with "Report spam" / "Not spam"; Spam and Trash empty themselves after 30 days.
- **Filters**: rules on incoming mail (from/to/subject/words/size/attachment) → skip inbox, mark read, star, label,
  forward, delete, never spam, categorise.
- **Mute** a thread: later replies skip the inbox.

### 1.6 Keyboard shortcuts (switched on in settings; `?` shows the sheet)

| Key | Action | Key | Action |
|---|---|---|---|
| `c` | compose | `/` | search |
| `j` / `k` | newer / older conversation | `n` / `p` | next / previous message in a thread |
| `o` / Enter | open | `u` | back to list |
| `e` | archive | `#` | delete |
| `r` / `a` / `f` | reply / reply all / forward | `s` | star |
| `x` | select | `l` / `v` | label / move to |
| `Shift+i` / `Shift+u` | mark read / unread | `!` | spam |
| `g` then `i` | go to Inbox | `g` then `s` / `t` / `d` | starred / sent / drafts |
| `z` | undo last action | `Ctrl/⌘+Enter` | send |

### 1.7 Empty states and feedback

- Empty inbox / folder: a calm illustration and a short line ("No new mail!", "Nothing in Spam"); empty Trash shows
  how long things stay there.
- Every action gives a toast at the bottom-left ("Conversation archived. Undo") with Undo.
- Loading: a thin progress bar at the top; the list keeps its place.

### 1.8 Mobile

- One column. List rows show avatar circles (tap to select), sender, subject, snippet, date, star.
- Swipe actions (configurable: archive, delete, mark read, snooze, move).
- A floating Compose button bottom-right that shrinks while scrolling.
- The rail becomes a slide-out drawer; search at the top as a rounded bar with the account avatar.
- Conversation: back arrow, archive, delete, mark unread, more; reply bar at the bottom.

### 1.9 Settings that matter to us

Send-as addresses (and "reply from the same address it was sent to"), signatures per address, undo-send delay,
default reply behaviour (reply vs reply all), conversation view on/off, keyboard shortcuts on/off, vacation responder,
filters and blocked addresses, forwarding, display density, desktop notifications.

---

## Part 2. Insightly (reference for BuPulse CRM)

### 2.1 Layout and navigation

- A left rail (or top tabs in older layouts) with one item per record type: **Home/Dashboards, Contacts,
  Organizations, Leads, Opportunities, Projects, Tasks, Emails, Calendar, Reports**, plus custom objects, and a
  settings gear. A global search box and a "+ New" quick-add menu in the top bar.
- **List views** per record type: a table with sortable columns, a view picker ("All contacts", "My contacts",
  "Recently viewed", saved custom views with filters), column chooser, bulk select with bulk actions (edit field, add
  tag, assign owner, delete, mass email, export).
- **Kanban / pipeline board** for opportunities and projects: one column per stage with the column's total value and
  count; cards with name, organisation, value, close date, owner avatar; drag a card to move it between stages.
- **Calendar**: month/week/day of tasks and events; synced to external calendars.

### 2.2 The record page (contact, organisation, opportunity)

- **Header:** avatar/logo, name, title + organisation, quick contact icons (email, phone), owner, tags as chips, and
  actions (Edit, Email, Add task, Add event, Add note, more: clone, merge, delete).
- **Left column — details:** all fields grouped in collapsible sections (contact info, address, social, background,
  custom fields), each editable in place.
- **Main column — related tabs:** Activity (a merged timeline), Related contacts/organisations/opportunities/projects,
  Emails (every linked email), Notes, Files, Tasks, Events. Each tab lists items newest first with a quick "add".
- **Links/relationships:** a contact can link to several organisations and opportunities with a role ("Decision
  maker", "Accountant").
- **Opportunity page** adds: stage progress bar along the top (click a stage to move), value, probability, forecast
  close date, pipeline, won/lost with a reason, and a state history.

### 2.3 Leads

- Separate from contacts: name, company, source, status (Open, Contacted, Qualified, Disqualified), rating.
- **Web-to-lead forms** create leads from a website form; leads can be **assigned** by rules.
- **Convert lead** in one step: becomes a contact + organisation + (optional) opportunity, keeping notes and
  activity.

### 2.4 Email in the CRM

- Emails reach the CRM by BCC/forwarding to a personal dropbox address, or from Gmail/Outlook add-ins that link a
  message to contacts and opportunities. Linked emails appear on every related record.
- **Email templates** with merge fields (first name, organisation...), and **mass email** to a list view with
  per-recipient merge, sending limits per day, open/click tracking where enabled.
- **Unsubscribe**: contacts carry an "email opted out" flag that mass email respects.

### 2.5 Tasks, events, reminders

- Tasks with due date, priority, owner, status, linked record, and an email reminder; task lists per user ("My open
  tasks", "Due today", "Overdue").
- Events (meetings) with time, place, attendees, linked record, reminders.
- Recurring tasks; task templates inside pipelines (moving to a stage can create tasks: "activity sets").

### 2.6 Automation and reporting

- Workflow automation: when a record is created/updated and conditions match → update a field, create a task, send
  an email, notify a user, call a webhook. Pipelines with activity sets per stage.
- Dashboards with cards (pipeline by stage, won this month, tasks due, new leads by source) and a report builder
  (tables, bar/pie charts, scheduled email of a report).

### 2.7 Data hygiene

- Import from CSV with column mapping and duplicate detection; export to CSV.
- Duplicate finder and **merge** two records keeping chosen fields.
- Custom fields per record type (text, number, date, dropdown, checkbox, URL...); required fields; field
  permissions per role.
- Roles and permissions, record ownership, visibility ("everyone", "owner only", "team").

### 2.8 Empty states and mobile

- Empty lists explain the record type in one line and offer "Add" and "Import".
- Mobile apps: record lists, a record page with tap-to-call/email/map, add notes and tasks, business-card scan;
  pipeline board as swipeable columns.

---

## Part 3. What BuPulse does better or simpler

Our users are a small Rwandan team today (cyusa@, office@, support@, sales@) and Rwandan small businesses later.
They live on phones, pay in RWF, talk on WhatsApp, and do not want to learn software. Everything below follows from that.

### Mail

1. **One rail, few folders.** Mailboxes first (cyusa@, office@, support@, sales@, Other) each with an unread count,
   then Inbox · Starred · Sent · Drafts · Archive · Spam · Trash, then labels. No automatic category tabs, no
   "Important" markers, no snooze in phase 1: fewer things to understand.
2. **Shared team inboxes done properly.** support@ and sales@ show who opened a thread, who replied, and allow
   "Assign to me" so two people never answer the same customer. Gmail needs a group + delegation for this.
3. **Reply from the right address, always.** A reply goes out from the mailbox the mail arrived in; the From picker
   only lists mailboxes the person may use. No settings page for "send as".
4. **Undo send by default** (10 seconds), autosaved drafts by default, keyboard shortcuts on by default (with a `?`
   sheet) — no hunting in settings.
5. **CRM in the side panel.** Opening a mail shows the sender's CRM card (company, deals, open tasks, last messages)
   on the right, with **Add to CRM**, **Create deal**, **Create task** in one click. Gmail needs add-ons for this.
6. **Plain search that understands both.** One box; typing `from:irembo` or just "irembo invoice" both work; filter
   chips (Unread, Has attachment, Mailbox, Date) under it instead of a long form.
7. **Calm visuals.** White cards on a soft grey page, one accent colour, the BuPulse logo top-left, no ads, no
   promotional tabs. Unread = bold + a small blue dot, not a heavy row.
8. **Mobile first-class.** Bottom sheet compose, swipe to archive/trash, big tap targets, a floating Compose button,
   the rail as a drawer. Works as a home-screen app.
9. **Free and owned.** Receiving via Cloudflare Email Routing, sending via Resend's free tier, mail stored in our own
   database and storage. Sending limits shown honestly ("78 of 100 emails left today").

### CRM

1. **Fewer record types.** People and Companies (a person may have no company), Deals, Tasks, Leads. No projects or
   custom objects in phase 1. A lead is simply a person with status "Lead" — converting is one button that adds a
   deal, not a three-record wizard.
2. **Every channel on the person.** Phone, email and **WhatsApp** buttons on the header (tap-to-WhatsApp with the
   number in international form). The timeline mixes mails (from BuPulse Mail, automatically, no BCC tricks), notes,
   tasks, deal moves, quote requests and website-chat messages.
3. **Money in RWF by default**, amounts formatted "1,250,000 RWF", pipeline totals per stage; other currencies only
   when a deal says so.
4. **Pipeline board you can drag on a phone.** Stages: New lead → Contacted → Quote sent → Negotiating → Won / Lost
   (editable). Won/Lost asks one short question (why lost?) and celebrates a win.
5. **Today page instead of dashboards.** One screen: new leads today (quote requests and contact messages from the
   website), tasks due today/overdue, deals closing this week, bookings today. Reports come later.
6. **Reminders where people are.** Task reminders by email and Telegram (already used for owner alerts), not only
   inside the app.
7. **Public booking link** (`crm.bupulse.com/book/<name>`) built in: pick a free slot, the booking lands on the
   calendar and in the person's timeline. Insightly needs an integration for this.
8. **Honest free bulk email.** Templates with simple merge fields ({first_name}, {company}); a send to 2,000 people is
   queued in batches inside the free 100/day limit with a progress bar and an end date; every bulk mail carries an
   unsubscribe link and unsubscribed people are skipped automatically.
9. **No import wizard needed on day one.** The admin's existing Sales leads move in automatically; CSV import with
   automatic column matching and duplicate merge by email/phone comes next.
10. **Same look as Mail**, same rail, same keyboard habits (`c` new, `/` search, `j/k`), one login, one switcher.
