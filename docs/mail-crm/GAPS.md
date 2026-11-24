# B Mail: design artifact vs real app (24 Nov 2026)

The owner: "everything that was in the artifact is supposed to be functioning on the mail you created". Design screens:
the "BuPulse Mail design" artifact (https://claude.ai/artifact/8ksBRm4qE6pFL9M6GgUpVC; local copy in the Mail session's
scratchpad, `mail-design/project/*.dc.html`). ⚠ = needs a server tool, a paid service or a later phase: deferred.

## (A) Inbox, list, menu — Mail session
1. Filter chips All / Unread / Important / Has attachment; Important toggle — S
2. "Forwarded to you" section, one folder per source (filter on copiedFrom) — S
3. Storage meter ("184 MB of 500 MB used") and Drafts count — S
4. Search options panel (from, to, subject, has attachment, unread, dates) — S
5. "More" menu, Move to folder, manual tags (MailLabel) — M
6. Sender pictures: team photos, Gravatar, site icon, initials palette — M (⚠ BIMI logos: deferred)
7. Drafts dead end: Undo sends to Drafts with no way to open or edit — M (with C3)

## (B) Reading, attachments, viewer — Mail session
1. Previous / next and "1 of N" — S
2. Split reading pane + switch Split / Full — M
3. Full screen: 10px margins, Return, slide-in menu, Print, ~72-char column — M
4. ⚠ Sender CRM card — waits for the CRM
5. Attachment hover Preview/Download, Download all (ZIP), "Checked, safe to open" — S/M (⚠ Save to CRM later)
6. Viewer controls: thumbnails, zoom, fit, rotate, find, print, details, file strip, arrow keys + Esc — L (pdf.js)
7. Free in-browser previews: video/audio, CSV table, code, ZIP list, SQLite, 3D glb/stl, docx (mammoth), xlsx (SheetJS) — M each
8. ⚠ PowerPoint, old .doc, .blend: LibreOffice/Blender on the office PC — deferred
9. Real first-page thumbnails for PDFs — M

## (C) Compose and reply — helper "compose"
1. Attach files: upload, storage, send through Resend, count toward quota — M
2. Department / Everyone as a recipient: one personal email each, {first_name}, "Insert {first_name}", "Sends N personal emails… uses N of 100", "See who gets it", "Send N emails" (sendableDepartmentIds) — L
3. Draft autosave, "Draft saved", reopening drafts from Drafts — M
4. Address suggestions (people, departments, recent contacts) — M
5. Reply / Reply all / Forward switch in the reply header; forward preview shows the Forwarded-message block — S

## (D) Settings, look, profile, signature — Mail session
1. Light / Dark / Auto — S
2. Quick settings side panel — M
3. Glass clarity + tint per person (MailSettings.glassClarity, glassTint, usersChangeGlass) — M
4. Gradient backgrounds + Random — S
5. Own-photo background (~300 KB, counts in storage) — M
6. 5 signature looks (picker + renderer) — M
7. Live signature preview — S
8. Settings tabs General / Look and signature / Notifications — M
9. Forwarding notice ("Mail to grace@ is also delivered to …") — S
10. Profile photo on avatars and the account menu — S

## (E) Console — helper "console"
1. Pages with a side menu: Users, Departments, Forwarding, Company and look, Spam and blocks, Sending and limits, Back to Mail — M
2. Summary cards: users/departments/admins; storage given vs used vs pool; sent today x/100 — M
3. Storage used per person with bar and − / + — M
4. Head badge, "Forwards to" column, avatars — S
5. Create-user page: address-free check, department chips with + New, Head switch, role descriptions, pool left, "What they get" preview with signature, shared mailbox ticks (MailboxAccess) — L. (Invite email: no — the owner chose a one-time password the admin hands over; the person chooses their own at first sign-in.)
6. New / rename / recolour / delete department; member avatars; "who may send" note — S
7. Forwarding "Keep a copy in their inbox" checkbox; name notes — S
8. Extra addresses (MailAlias) list + add — S
9. Liquid glass settings (clarity, tint, each person may change it, live preview) + default signature look — M
10. Spam and blocks page (MailSenderRule) — M
11. Sending and limits page (100/day Resend free, undo seconds, today's count) — S

## (F) Phone — Mail session
1. Menu starts closed on phones (bug: it covers the screen) — S
2. iOS-style list: large title, mailbox tabs, two-line rows, unread dot — M
3. Swipe actions — M
4. Floating bottom bar (Mailboxes, Search + dictation, Compose) — M
5. Phone thread screen with previous/next and bottom actions — M

## (G) Opening, welcome — Mail session
1. Welcome after the first sign-in: photo (take/upload, zoom, crop, ~60 KB), "How people see you", photo in signature switch, Gmail photo guide, Skip / Continue — L
2. Preloader — DONE 1d0e1137
3. Real BuPulse mark traced for the pulsing B — DONE 1d0e1137
