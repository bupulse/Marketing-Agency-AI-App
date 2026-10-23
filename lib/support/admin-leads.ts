import "server-only";
import { listSupportLeads } from "./leads";

// Chat leads for Admin -> Live chat: the people who filled in the help chat's form (name, email, business, WhatsApp)
// and their first question, read through listSupportLeads (ContactRequest rows of kind "support_chat"). The page only
// uses chatLeads and ChatLead.

export { SUPPORT_LEAD_KIND } from "./prechat";
export const CHAT_LEADS_PAGE = 50;

export type ChatLead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  /** The first question they asked. */
  message: string;
  createdAt: string;
  /** Their latest help chat, to open in the support app; null when none was found. */
  conversationId: string | null;
};

/** Newest first, `limit` at a time; `after` is the last id of the page before. */
export async function chatLeads(opts: { after?: string | null; limit?: number } = {}): Promise<{ items: ChatLead[]; next: string | null }> {
  return listSupportLeads({ limit: CHAT_LEADS_PAGE, ...opts });
}
