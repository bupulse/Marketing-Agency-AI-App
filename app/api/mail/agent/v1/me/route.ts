import { agentJson, agentRoute, agentSendsLeftNow } from "@/lib/mail/agent";

// GET /api/mail/agent/v1/me: the key's mailbox, its sender name and today's sends (docs/mail-crm/AGENT_API.md).
export const GET = agentRoute(async (ctx) => {
  const sends = await agentSendsLeftNow(ctx.key);
  return agentJson({
    mailbox: { address: ctx.mailbox.address, name: ctx.mailbox.name },
    key: { name: ctx.key.name, prefix: ctx.key.prefix, fromName: ctx.key.fromName, signature: ctx.key.signature },
    sends: { dailyLimit: ctx.key.dailyLimit, sentToday: sends.keySentToday, teamLeft: sends.teamLeft, left: sends.left },
  });
});
