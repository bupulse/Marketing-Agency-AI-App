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

If you don't already have one, add a DMARC record in Cloudflare too: TXT `_dmarc` with
`v=DMARC1; p=none; rua=mailto:bupulse.office@gmail.com`. It helps Gmail trust the emails.

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

## 3. Supabase: email designs

**Authentication → Emails → Templates**. For each one, paste the subject and the whole HTML file:

| Template | Subject | File |
|---|---|---|
| Confirm signup | `Confirm your email to start your BuPulse trial` | `supabase/templates/confirm-signup.html` |
| Reset password | `Reset your BuPulse password` | `supabase/templates/reset-password.html` |
| Change email address | `Confirm your new email for BuPulse` | `supabase/templates/email-change.html` |

The buttons link to `/auth/confirm` with a one-time code, which works in any browser
(including when the email is opened on a phone).

## 4. Supabase: sign-in settings

- **Authentication → Sign In / Providers → Email**: Email provider **on**, **Confirm email on**,
  minimum password length **8**, password requirements **letters and digits**.
  Email OTP expiration **86400** seconds (24 hours, as the emails say).
- **Authentication → URL Configuration**:
  - Site URL: `http://localhost:3000` while developing, `https://bupulse.com` after launch.
    (The email links use this address.)
  - Redirect URLs: `http://localhost:3000/**` and `https://bupulse.com/**`.
- Google sign-in: **Authentication → Sign In / Providers → Google** with a Google Cloud OAuth client
  (redirect URI shown on that page).

## 5. Test

1. Open http://localhost:3000/signup, create an account with an email you can read.
2. The email should arrive from **BuPulse &lt;register@bupulse.com&gt;** within a minute, in the inbox (not spam).
3. Click **Confirm my email** → you land in the dashboard with a 7-day trial.
4. In Gmail, open the email's **⋮ → Show original**: SPF, DKIM and DMARC should all say **PASS**.

The logo in the emails loads from `https://bupulse.com/brand/logo-white.png`, so it appears once
the site is live; until then email apps show the text "BuPulse" in its place.
