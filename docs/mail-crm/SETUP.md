# B Mail go-live (owner's choice, 23 Nov 2026: straight to bupulse.com)

bupulse.com already uses **Cloudflare Email Routing** (MX route1/2/3.mx.cloudflare.net, SPF includes
_spf.mx.cloudflare.net) and today forwards mail to the owner's Gmail. **No DNS record changes.** Sending already works:
Resend is verified for bupulse.com (DKIM resend._domainkey, MAIL FROM send.bupulse.com). B Mail is served at
**bupulse.com/mail** (mail.bupulse.com later, which needs a DNS name + tunnel route and the owner's OK).

## 1. The app on bupulse.com (main session bupulse-2c, with the owner's "deploy it")

1. Merge `mail-crm` into `main`.
2. Production database: back up, then `prisma migrate deploy` (three additive migrations: `20261123120000_mail`,
   `20261123130000_mail_console`, `20261123140000_mail_departments`; they also create the private "mail" bucket).
3. Production setting `MAIL_INBOUND_SECRET`: a random 48-character secret, the same value as the Worker's (step 2.3).
   Kept in the Mac's Keychain as service `bupulse-mail-inbound-secret`, account `bupulse`:
   `security find-generic-password -s bupulse-mail-inbound-secret -a bupulse -w | netlify env:set MAIL_INBOUND_SECRET --context production` (never printed).
4. Deploy (update.ps1 over CRD). Check `https://bupulse.com/mail` shows the B Mail sign-in.
5. The owner signs in at bupulse.com/mail with **admin@bupulse.com + the authenticator code** (the owner is
   ADMIN_EMAILS; the same authenticator as the admin console).

## 2. The Email Worker (Cloudflare; the owner logs in once: `npx wrangler login`)

**Done 23 Nov 2026:** wrangler logged in (BuPulse Cloudflare account, OAuth with email_routing:write), Worker
`bupulse-mail-inbound` deployed (no workers.dev address), secrets MAIL_INBOUND_SECRET and SAFETY_COPY_TO set. Today's
routing: only the catch-all, forwarding to the owner's Gmail (no custom address rules).

1. `npx wrangler deploy --config workers/mail-inbound/wrangler.toml` (Worker `bupulse-mail-inbound`, free plan).
2. Safety copy for the first days: `npx wrangler secret put SAFETY_COPY_TO --config workers/mail-inbound/wrangler.toml`
   with the owner's current Gmail (already a confirmed destination in Email Routing). Kept out of the repository.
3. `npx wrangler secret put MAIL_INBOUND_SECRET --config workers/mail-inbound/wrangler.toml`, value from the Keychain.

## 3. Switch the routing (Cloudflare dashboard → bupulse.com → Email → Email Routing → Routing rules)

1. **Catch-all address**: Edit → Action **Send to a Worker** → `bupulse-mail-inbound` → Save, Enabled. (Or the API:
   `PUT /zones/<zone>/email/routing/rules/catch_all` with `{"matchers":[{"type":"all"}],"actions":[{"type":"worker","value":["bupulse-mail-inbound"]}],"enabled":true}`.)
2. Every **custom address** rule that forwards to Gmail (cyusa@, office@...): Edit → Send to a Worker →
   `bupulse-mail-inbound` (custom rules win over the catch-all), or delete it so the catch-all takes it.
3. Test: send from Gmail to cyusa@bupulse.com, office@bupulse.com and a made-up name@bupulse.com. Each shows in B Mail
   (Cyusa, Office, Other) within seconds, and a copy still reaches Gmail.

## 4. After a few days of B Mail working

1. `npx wrangler secret delete SAFETY_COPY_TO --config workers/mail-inbound/wrangler.toml` (no more Gmail copies).
2. Email Routing → Destination addresses: delete the Gmail address (and any rule still pointing at it).

## If something goes wrong

The Worker answers "451 try again later" whenever the app does not answer, so senders retry for hours: nothing is lost.
To go back: set the catch-all to **Send to an email** → the Gmail address again (one click).
