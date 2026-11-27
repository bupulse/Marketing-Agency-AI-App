-- B Mail agent keys (docs/mail-crm/AGENT_API.md): server-only like every Mail table. RLS is on with no policies
-- (20261126120000_mail_agent_keys); this also takes away the table grants from the API roles. Additive only.

REVOKE ALL ON TABLE "MailAgentKey" FROM PUBLIC, anon, authenticated, service_role;
