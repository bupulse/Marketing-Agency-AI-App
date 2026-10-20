import "server-only";
import { prisma } from "@/lib/db";
import { registerChannel } from "../channels";
import { ChannelSendError, type ChannelAdapter } from "../types";

// The website chat (lib/widget) as an inbox channel. Visitors' messages reach the engine from lib/widget/chat.ts.
// Replies from automations or a teammate are added to the chat session (ChatMessage, role "assistant", or "agent" for a
// person) and the chat bubble shows them on its next check for new messages.

export const websiteChannel: ChannelAdapter = {
  kind: "WEBSITE",
  capabilities: { buttons: true, quickReplies: true, images: false, commentReply: false, privateReply: false, windowHours: null },
  async available() {
    return true;
  },
  async send(target, message) {
    if (!target.chatSessionId) throw new ChannelSendError("This website chat has ended.", false, "no_session");
    const row = await prisma.chatMessage.create({
      data: { sessionId: target.chatSessionId, role: "assistant", content: message.text },
      select: { id: true },
    });
    await prisma.chatSession.update({ where: { id: target.chatSessionId }, data: { lastMessageAt: new Date() } });
    return { externalId: row.id };
  },
};

registerChannel(websiteChannel);
