# Instagram replies through Composio: messages for the owner to send

Written 19 October 2026 after a live test on @bu.pulse (TEST database, company "LEAF Business GROUP LTD"). The owner sends
these himself; nothing was sent by BuPulse or Claude.

## What the test showed

| Step | Result |
|---|---|
| Composio reads @bu.pulse DMs (`INSTAGRAM_LIST_ALL_CONVERSATIONS`, `INSTAGRAM_LIST_ALL_MESSAGES`) | Works, after "Allow access to messages" was switched on in the Instagram app |
| BuPulse puts the DM in the Inbox and the `BPTEST7` automation picks its reply | Works |
| Composio sends the reply (`INSTAGRAM_SEND_TEXT_MESSAGE`) | Refused by Meta: 403, code 10, subcode 2534022, "This message is sent outside of allowed window" |

Four send attempts, all refused, between 20:23 and 20:31 UTC on 19 Oct 2026, while the customer's last message was from
20:26:30 UTC (inside the 24-hour window), after the message request was accepted and after a manual reply from
@bu.pulse. The connection is Composio-managed OAuth (OAUTH2, `is_composio_managed: true`) with the requested scopes
`instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`,
`instagram_business_content_publish`, `instagram_business_manage_insights`. @bu.pulse is a Business account.

Known issue: [ComposioHQ/composio #4847](https://github.com/ComposioHQ/composio/issues/4847) (same error, reads work,
sends fail). Composio's Instagram docs say an owned Meta app is "the current unblock path for production usage"
([docs](https://docs.composio.dev/toolkits/instagram)).

## 1. Message to Composio support (email, Discord or the dashboard's support chat)

> Subject: Instagram managed auth: INSTAGRAM_SEND_TEXT_MESSAGE always fails with 2534022 inside the 24h window
>
> Hello Composio team,
>
> We use Composio-managed OAuth for the Instagram toolkit (Instagram Business account @bu.pulse). Reading works:
> INSTAGRAM_LIST_ALL_CONVERSATIONS and INSTAGRAM_LIST_ALL_MESSAGES return the customer's messages. But every
> INSTAGRAM_SEND_TEXT_MESSAGE to that customer fails with 403, code 10, error_subcode 2534022 ("This message is sent
> outside of allowed window"), even 30 seconds after the customer's message, with the message request accepted and
> "Allow access to messages" switched on. It looks like issue #4847.
>
> Our connected account id is in our Composio dashboard (Instagram toolkit, connected 15 Oct 2026). Example failed
> attempts on 19 Oct 2026: 20:27:06 and 20:29:01 UTC (Meta fbtrace ids available on request).
>
> Questions:
> 1. Does Composio's managed Meta app have Advanced Access for instagram_business_manage_messages? If not, when will it?
> 2. Is there anything we can do on our side, without creating our own Meta app, to send replies today?
>
> Thank you,
> Euzeb, BuPulse (bupulse.com)

## 2. Comment for GitHub issue #4847

> Same problem here, on a Business account (not Creator). Composio-managed auth, reads work
> (LIST_ALL_CONVERSATIONS / LIST_ALL_MESSAGES), every INSTAGRAM_SEND_TEXT_MESSAGE fails with 403 / code 10 / subcode
> 2534022 within seconds of the user's message, after accepting the message request and enabling "Allow access to
> messages". Is there an ETA for Advanced Access on the managed app, or a workaround that does not need our own
> Meta app?

## When Composio fixes it

Nothing to change in BuPulse: switch on "Answer comments and messages" for @bu.pulse on the Channels page, publish an
automation, and send it a DM. The live test driver used on 19 Oct is described in `docs/handovers/bizdev.md`.
