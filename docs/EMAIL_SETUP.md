# Sending BuPulse emails from register@bupulse.com

Sign-up confirmations, password resets and email changes are sent by Supabase Auth through
Resend (free: 3,000 emails a month, 100 a day). The email designs are in `supabase/templates/`.

## 1. Resend: verify bupulse.com

1. Create a free account at https://resend.com with bupulse.office@gmail.com.
2. **Domains → Add domain** → `bupulse.com` → region **US East (N. Virginia)** (same region as the database).
3. Resend shows 3–4 DNS records (an MX and TXT for `send.bupulse.com`, a DKIM TXT `resend._domainkey`,
   and an optional DMARC TXT). In **Cloudflare → bupulse.com → DNS → Records → Add record**, add each one
   exactly as shown. Set every record to **DNS only** (grey cloud).
4. Back in Resend press **Verify**. It usually turns green within minutes.
5. **API Keys → Create API key** → name `supabase-auth`, permission **Sending access**, domain `bupulse.com`.
   Copy the key (starts with `re_`); it is shown once.

Add a DMARC record in Cloudflare too (it helps Gmail trust the emails): TXT, name `_dmarc`, value
`v=DMARC1; p=none; rua=mailto:office@bupulse.com`. Mail *to* bupulse.com is Google Workspace (its MX records stay as
they are); Resend sends *from* `send.bupulse.com`, so its SPF and MX records live on that subdomain and do not touch
Workspace. `p=none` only collects reports; tighten to `p=quarantine` once a few weeks of reports show SPF and DKIM pass.

## 2. Supabase: send through Resend

**Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP**

| Field | Value |
|---|---|
| Sender email | `register@bupulse.com` |
| Sender name | `BuPulse` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (all lowercase — `Resend` makes every email fail with "Error sending confirmation email") |
| Password | the `re_…` API key |
| Minimum interval between emails | 60 seconds |

Then **Authentication → Rate Limits → Rate limit for sending emails**: raise from 2 to 30 per hour.

## 3. How people confirm: a code or a link

Every sign-up, creator sign-up and password-reset email holds **both** a code (6 to 10 digits, Supabase's
"Email OTP Length") and a button. Either works, so an email opened on a phone confirms a sign-up started on a computer.

| Email | Code typed on | Link |
|---|---|---|
| Confirm signup (business and creator) | "Confirm your email" after `/signup` and `/creators/signup` (`confirmEmailCode`, `verifyOtp` type `email`, then `signup` for older projects) | `/auth/confirm?token_hash=…&type=email` |
| Reset password | `/forgot-password` after "Send code and link" (`verifyResetCode`, type `recovery`) → `/reset-password` | `/auth/confirm?token_hash=…&type=recovery&next=/reset-password` |
| Change email address | (no code box yet; the link) | `/auth/confirm?token_hash=…&type=email_change&next=/dashboard/settings` |
| Magic Link (admin sign-in only) | `/admin/login` and `/admin/setup-2fa` | none: the admin email is code-only (`docs/ADMIN.md`) |

- Codes are limited per address across every IP (`confirmCode`, `resetCode` in `lib/request-limits.ts`: 10 per
  15 minutes) and every wrong code gets the same answer in the same time. The link in the same email keeps working.
- After a code or a link the person goes where the sign-up said: the `next` it carried, else the sign-up's metadata
  (`account_kind: "creator"` → `/creator/profile`, `return_to` → e.g. a Shopify install), else `/dashboard`
  (`lib/auth/confirm-next.ts`). The branded links carry no `next` because one template serves both sign-ups.
- `/auth/confirm` also accepts Supabase's own links (the default templates: `{{ .ConfirmationURL }}` → Supabase
  `/verify` → back with `?code=`). The code only works in the browser that signed up; in any other browser Supabase
  has already confirmed the address, so the person lands on `/login` with "Your email is confirmed. Sign in to
  continue." (a reset opened elsewhere lands on `/forgot-password` with a note). Supabase's `error_code=otp_expired`
  or `access_denied` gets the "expired" screen with a way to get a new code and link.

## 4. Supabase: email designs and URLs (the install script)

The designs are in `supabase/templates/` and their subjects in `supabase/templates/subjects.json`:

| Template | Subject | File |
|---|---|---|
| Confirm signup | `Confirm your email for BuPulse` | `confirm-signup.html` |
| Reset password | `Reset your BuPulse password` | `reset-password.html` |
| Change email address | `Confirm your new email for BuPulse` | `email-change.html` |
| Magic Link | `Your BuPulse admin code` | `magic-link.html` |

**Links use the project's Site URL.** The buttons are `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…`,
not `{{ .RedirectTo }}` (which falls back to the bare Site URL, with no query to append to, whenever a redirect is
missing from the allow list) and not `{{ .ConfirmationURL }}` (PKCE: one browser only). So each project's Site URL
must be its public address:

| Project | Site URL | Redirect URLs |
|---|---|---|
| TEST | `https://test.bupulse.com` | `https://test.bupulse.com/**,http://localhost:3001/**` |
| Production | `https://bupulse.com` | `https://bupulse.com/**` |

Never leave a Site URL on `http://localhost:…`: the email links would not open on any other device.

**Install** with the Management API (no copy-paste in the dashboard). Needs a personal access token
(Supabase → Account → Access Tokens) and the project ref (Project Settings → General). Always dry-run first:

```bash
SUPABASE_ACCESS_TOKEN=sbp_… node scripts/supabase-auth-emails.mjs <project-ref> \
  --site https://test.bupulse.com --allow "https://test.bupulse.com/**,http://localhost:3001/**" --otp-exp 86400 --dry-run
# then the same without --dry-run
```

- Sets the four subjects and bodies always; `site_url` (`--site`), `uri_allow_list` (`--allow`), `mailer_otp_length`
  (`--otp-length 6..10`) and `mailer_otp_exp` (`--otp-exp`, seconds, at most 86400) only when given.
- Checks each template first (the code `{{ .Token }}`, the `/auth/confirm` link, no link in the admin email).
- Prints field names, lengths, subjects and URLs only: never the token or the bodies. Warns when the Site URL is
  localhost or the code expiry is not the 24 hours the emails promise.
- The admin code length: `docs/ADMIN.md` (8 digits today). The code boxes accept 6 to 10.

## 5. Supabase: sign-in settings

- **Authentication → Sign In / Providers → Email**: Email provider **on**, **Confirm email on**,
  minimum password length **8**, password requirements **letters and digits**.
  Email OTP expiration **86400** seconds (24 hours, as the emails say; `--otp-exp 86400`).
- **Authentication → URL Configuration**: set by the install script (table above).
- Google sign-in: **Authentication → Sign In / Providers → Google** with a Google Cloud OAuth client
  (redirect URI shown on that page).

## 6. Test

1. Open https://test.bupulse.com/signup, create an account with an email you can read.
2. The email should arrive from **BuPulse &lt;register@bupulse.com&gt;** within a minute, in the inbox (not spam),
   with a big code and a **Confirm my email** button.
3. Type the code on the "Confirm your email" screen → the dashboard with a 7-day trial. (Or open the link, on any device.)
4. `/forgot-password` → the code → "Choose a new password".
5. In Gmail, open the email's **⋮ → Show original**: SPF, DKIM and DMARC should all say **PASS**.

The logo in the emails loads from `https://bupulse.com/brand/logo-white.png`.

## Troubleshooting

- **No email:** Resend → **Emails** shows every send: *Delivered*, *Bounced* (the address does not exist) or
  *Complained*. Nothing there means Supabase did not send: check Supabase → Logs → Auth, the SMTP settings
  (username `resend`, lowercase) and Authentication → Rate Limits.
- **Typos:** `bupuls.com`, `gmial.com` and similar bounce; Resend shows the address exactly as typed.
- **Workspace mailboxes:** `admin@bupulse.com` and `office@bupulse.com` are separate Google Workspace mailboxes (not
  aliases): an admin code goes to the address typed on `/admin/login`, so look in that mailbox. DMARC reports go to
  `office@`.
- **"This link has expired or was already used"** after opening a link: links and codes work once. If the address
  was confirmed already, sign in; otherwise "Resend email" sends a new code and link.
- **Default Supabase email** ("Confirm your email address", a link to `….supabase.co/auth/v1/verify`): the branded
  templates are not installed on that project; run the install script.
- **Link opens localhost:** that project's Site URL is localhost; rerun the script with `--site`.
- **Admin code never arrives:** the page answers the same for everyone, so the reason is in Admin → Errors (another
  admin's session) or the `ErrorLog` table, source `admin.login.code`. The owner's address with no sign-in gets one
  automatically (`docs/ADMIN.md`).
