# Support chat API, v1

The one back end for the support chat widget, the support web app and later the desktop and phone apps. Base path:
`/api/support/v1`. The types are in `lib/support/contract.ts` (TypeScript and zod); this page is the short reference.
How it works inside: `docs/SUPPORT_CHAT.md` section 9. Breaking changes go to `/api/support/v2`.

## Conventions

- JSON in and out. Answers are never cached.
- Every error answers `{ "error": { "code": "…", "message": "…" } }`. The message is plain English, safe to show to a person. Common codes:

| Status | Codes |
|---|---|
| 400 | `invalid_json`, `invalid_request` |
| 401 | `visit_required`, `visit_expired`, `unauthorized` |
| 403 | `form_required`, `challenge_required`, `challenge_failed`, `mfa_required`, `not_agent`, `locked`, `not_yours`, `supervisor_only` |
| 404 | `not_found` |
| 409 | `closed`, `already_chatting`, `attachment_not_ready` |
| 429 | `rate_limited`, with a `Retry-After` header |
| 503 | `assist_failed`, `translate_failed`, `realtime_unavailable` |

- `clientMsgId` (8 to 64 characters, made by the client) makes sends idempotent. Sending the same one again returns the first result and stores nothing new. Retry freely.
- Times are ISO 8601 UTC. Team hours are Kigali time.

## Visitor routes

Send `X-Support-Visit: <visitToken>` on every route except `POST /visit`.

| Route | Body | Answer |
|---|---|---|
| `POST /visit` | `visitBody` (`visitorKey`, `surface`, `path`, `title?`, `referrer?`, `screenW?`, `optOut?`) | `VisitResponse` |
| `POST /prechat` | `prechatBody` (`name`, `email`, `business`, `whatsapp?`, `turnstileToken?`) | `{ me }` |
| `POST /conversations` | `sendMessageBody` (`text`, `clientMsgId`, `turnstileToken?`) | `SendMessageResponse` |
| `GET /conversations/:id/messages?after=<message id>` | — | `{ messages, status, aiActive, agent }` |
| `POST /conversations/:id/messages` | `sendMessageBody` (`text` and/or `attachmentId`) | `SendMessageResponse` |
| `POST /conversations/:id/typing` | `typingBody` (`draft?`) | 204 |
| `POST /conversations/:id/human` | — | `SendMessageResponse` |
| `POST /conversations/:id/uploads` | `uploadBody` (`mime`, `bytes`, `fileName?`, `durationSec?`) | `UploadResponse` |
| `POST /conversations/:id/uploads/:aid/done` | — | `{ attachmentId }` |
| `POST /conversations/:id/rating` | `ratingBody` (`score` 1 or -1, `comment?`, `sendTranscript?`) | 204 |
| `POST /conversations/:id/end` | — | 204 |

Notes:
- **`POST /visit`:** call it on every page load, with the `X-Support-Visit` header you already have. Same visit: the same token comes back. Expired (20 minutes without a heartbeat): a new token.
  - `me.needsForm` is true on public pages and the bio link until the form is sent. `POST /conversations` refuses with `form_required` until then.
  - `greeting` is null on phones, on the bio link, with a chat open, or within 7 days of a chat.
  - `topic` is the visitor's own real-time topic, the same as every `conversation.topic`. `whatsapp` (E.164) shows "Continue on WhatsApp"; `turnstileSiteKey` is set when the bot check is on.
- **Heartbeat:** straight to Supabase, never to this API: `supabase.rpc("support_heartbeat", { p_token, p_path, p_title })` every 30–60 s while the tab is visible.
  - It answers `{ ok: true, unread }`. If `unread` is above 0, open the panel.
  - It may answer `{ ok: false, error: "expired" | "unknown" }`: call `/visit` again.
- **Sending:** the AI's answer comes back in the same response, with sources and buttons (`MessageView.sources`, `MessageView.actions`). Show a typing indicator while you wait (a few seconds).
- **Turnstile:** when the site's keys are set, a new chat, every 10th message, a message faster than 1.2 s after the previous one, and the form all need `turnstileToken`. Without one they answer `challenge_required`.
- **Real time:** join the public channel `topic` (`sv:<secret>`) while the panel is open, with `realtime.url` and `realtime.anonKey`. Events arrive as broadcast event `support` with a `RealtimeEvent` payload. On `message.created`, call `GET …/messages?after=<last id>`. If the socket is down, poll every 5 s.
- **Uploads:**
  1. `POST …/uploads` returns `uploadUrl` and `token`. PUT the file to `uploadUrl` with its `Content-Type`; supabase-js can use `uploadToSignedUrl(path, token, file)` instead.
  2. Call `…/done`.
  3. Send a message with `attachmentId`.

  A voice note's `…/done` takes a few seconds because the transcript is made there. Limits are in `UPLOAD_LIMITS`.
- **Coming back from an email:** links open the site at `/?help=open`, and the widget should open the chat then.
- **EVENT messages** are visitor-ready one-liners ("Jean M. joined · the AI stepped back"): show `body` as it is.
- **A 401 or 404 on the visit token:** call `POST /visit` again once.

## Agent routes

Send `Authorization: Bearer <Supabase access token>` from a session signed in with email, password and the authenticator code (`aal2`).

| Route | Body | Answer |
|---|---|---|
| `GET /agent/me` | — | `AgentMe` |
| `PATCH /agent/me` | `availabilityBody` (`online`, `away`, `offline`) | `AgentMe` |
| `POST /agent/devices` | `deviceBody` (a `PushSubscription.toJSON()`, `label?`, `kind?`) | 201 `{ id }` |
| `DELETE /agent/devices/:id` | — | 204 |
| `GET /agent/conversations?view=mine\|waiting\|ai\|all&q=&after=&limit=` | — | `{ items: ConversationListItem[], next }` |
| `GET /agent/conversations/:id` | — | `ConversationDetail` (marks the visitor's messages seen) |
| `POST /agent/conversations/:id/messages` | `agentMessageBody` (`text`, `kind` TEXT\|NOTE, `clientMsgId`, `translateTo?`) | `{ message }` |
| `POST /agent/conversations/:id/takeover` | — | `ConversationDetail` |
| `POST /agent/conversations/:id/release` | — | `ConversationDetail` (back to the AI) |
| `POST /agent/conversations/:id/assign` | `assignBody` (`agentId?`, `department?`, `note?`) | `ConversationDetail` |
| `POST /agent/conversations/:id/close` | — | `ConversationDetail` |
| `POST /agent/conversations/:id/reopen` | — | `ConversationDetail` |
| `POST /agent/conversations/:id/typing` | — | 204 |
| `GET /agent/conversations/:id/assist` | — | `Assist` (cached per last message) |
| `POST /agent/assist/rewrite` | `rewriteBody` (`text`, `style`, `lang?`) | `{ text }` |
| `GET /agent/team` | — | `{ agents: TeamMember[] }` (active agents and their open chats) |
| `GET /agent/visitors/live` | — | `{ items: LiveVisitor[], counts }` |
| `POST /agent/visitors/:visitorId/invite` | `inviteVisitorBody` (`text`) | 201 `{ conversationId }` |
| `GET /agent/stats?from=&to=` | — | `Stats` (supervisors; default the last 7 days, at most a year) |
| `GET /agent/realtime` | — | `{ url, anonKey, topics }` |

Notes:
- **Who sees what:** supervisors see every chat. Agents see the AI's chats, the waiting ones and their own. Another agent's chat answers `not_yours`.
- **Replying:** a TEXT reply takes the chat over (the AI goes quiet). A NOTE is internal.
- **Translating:** `translateTo` (an ISO 639-1 code) sends the text translated. `ConversationDetail.messages[].original` keeps what the agent wrote.
- **The list:** it is sorted by the last message, newest first. Within a page, upset, urgent and hot-lead chats come first; the `waiting` view puts the longest wait first. `next` is the cursor for `after`.
- **Real time:**
  1. Join the topics from `/agent/realtime` as **private** channels, with the agent's own access token (`supabase.realtime.setAuth(token)`).
  2. Also join `conv:<id>` while a chat is open.
  3. Use Presence on `staff:presence` for who is online.
  4. On `agent.force_logout` for your id, sign out.
  5. If the socket is down, re-query every 15 s.
- **Push:** register the browser's subscription with `POST /agent/devices`. Alerts go to the agents on duty (online or away), members of the chat's department first.
- **Sign-in rules:** the same as the support app's pages (`agentAccess`, `lib/support/app-access.ts`). Invitations and new passwords are the support app's (sc-app).

## Admin (server functions, not HTTP)

Admin → Live chat calls these from server actions:
- agents, departments and invites: `lib/support/agents.ts` (sc-app);
- settings: `getSupportSettings` and `saveSupportSettings` in `lib/support/settings.ts`;
- chat leads: `listSupportLeads({ after, limit })` in `lib/support/leads.ts`;
- after locking an agent: `forceLogout(agentId)` in `lib/support/realtime.ts`.
