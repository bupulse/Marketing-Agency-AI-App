import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { isServiceEnabled } from "@/lib/admin/switch";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { telegramText, type LeadAlert } from "./format";
import { getTelegramUpdates, latestPrivateChat, sendTelegramMessage, telegramToken, TELEGRAM_TOKEN_ENV, type TelegramChat } from "./telegram";

// Admin -> Settings, "Lead alerts -> Telegram": which Telegram chat the instant lead alerts go to. The owner makes a bot
// with @BotFather, pastes its token in Admin -> Services (TELEGRAM_BOT_TOKEN), sends /start to the bot, then presses
// Connect: getUpdates finds that private chat and its id is saved here (AdminSetting "alerts.telegram"), audited.

export const TELEGRAM_CHAT_SETTING = "alerts.telegram";

type Stored = { chatId: string; name: string; connectedAt: string };

export type TelegramStatus = {
  /** TELEGRAM_BOT_TOKEN is set (in Admin -> Services or the host). */
  hasToken: boolean;
  /** Switched on in Admin -> Services (on unless the owner switched it off). */
  enabled: boolean;
  chat: (Stored & { connected: true }) | null;
};

function readValue(value: unknown): Stored | null {
  const v = value as Partial<Stored> | null;
  return v && typeof v === "object" && typeof v.chatId === "string" && /^-?\d{1,20}$/.test(v.chatId) ? { chatId: v.chatId, name: String(v.name ?? ""), connectedAt: String(v.connectedAt ?? "") } : null;
}

/** The connected chat, or null. Never throws: a database blip means no Telegram alert, not a failed form. */
export async function readTelegramChat(): Promise<Stored | null> {
  const row = await prisma.adminSetting.findUnique({ where: { key: TELEGRAM_CHAT_SETTING } }).catch(() => null);
  return readValue(row?.value);
}

export async function telegramStatus(): Promise<TelegramStatus> {
  // isServiceEnabled loads the keys saved in Admin -> Services into process.env first.
  const enabled = await isServiceEnabled("telegram");
  const chat = await readTelegramChat();
  return { hasToken: !!telegramToken(), enabled, chat: chat ? { ...chat, connected: true } : null };
}

/** The token, or a message the admin can act on. */
async function requireToken(): Promise<string> {
  await isServiceEnabled("telegram"); // loads saved keys
  const token = telegramToken();
  if (!token) throw new AdminError("conflict", `Paste your bot's token (${TELEGRAM_TOKEN_ENV}) on the Telegram card in Admin -> Services first.`);
  return token;
}

/**
 * "Connect": finds the private chat that last wrote to the bot and saves it. `fetchImpl` is for the tests.
 * The bot then says hello in that chat, so the owner sees at once that it worked.
 */
export async function connectTelegram(ctx: AdminContext, fetchImpl: typeof fetch = fetch): Promise<TelegramChat> {
  const token = await requireToken();
  const updates = await getTelegramUpdates(token, fetchImpl);
  if (!updates.ok) throw new AdminError("conflict", `${updates.error} Check the token in Admin -> Services.`);
  const chat = latestPrivateChat(updates.updates);
  if (!chat) throw new AdminError("conflict", "No message to the bot was found. Open your bot in Telegram, send /start, then press Connect again within a few minutes.");
  const before = await readTelegramChat();
  const next: Stored = { chatId: chat.id, name: chat.name, connectedAt: new Date().toISOString() };
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.upsert({ where: { key: TELEGRAM_CHAT_SETTING }, create: { key: TELEGRAM_CHAT_SETTING, value: next as Prisma.InputJsonValue }, update: { value: next as Prisma.InputJsonValue } });
    await writeAudit(tx, ctx, "update_setting", `setting:${TELEGRAM_CHAT_SETTING}`, before ? { chatId: before.chatId, name: before.name } : null, { chatId: next.chatId, name: next.name });
  });
  await sendTelegramMessage({ chatId: chat.id, text: "BuPulse is connected. New quote requests and website chats will arrive here the moment they come in.", token }, fetchImpl);
  return chat;
}

export async function disconnectTelegram(ctx: AdminContext): Promise<{ name: string | null }> {
  const before = await readTelegramChat();
  if (!before) return { name: null };
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.deleteMany({ where: { key: TELEGRAM_CHAT_SETTING } });
    await writeAudit(tx, ctx, "update_setting", `setting:${TELEGRAM_CHAT_SETTING}`, { chatId: before.chatId, name: before.name }, null);
  });
  return { name: before.name };
}

/** A made-up lead with placeholder details, so the owner sees exactly what a real alert looks like. */
export function sampleAlert(now = new Date()): LeadAlert {
  return {
    kind: "quote",
    name: "Test Person",
    phone: "+250788000000",
    email: "test@example.com",
    company: "Sample Shop Ltd (test alert)",
    note: "This is a test alert from Admin -> Settings. Nobody asked for a quote.",
    source: "instagram",
    page: `${publicSiteUrl()}/quote?src=instagram`,
    at: now,
    openUrl: `${publicSiteUrl()}/admin/quotes`,
  };
}

/** "Send test alert". */
export async function sendTelegramTestAlert(fetchImpl: typeof fetch = fetch): Promise<{ name: string }> {
  const token = await requireToken();
  const chat = await readTelegramChat();
  if (!chat) throw new AdminError("conflict", "Connect a Telegram chat first.");
  const r = await sendTelegramMessage({ chatId: chat.chatId, text: telegramText(sampleAlert()), token }, fetchImpl);
  if (!r.ok) throw new AdminError("conflict", `The test alert was not sent. ${r.error}`);
  return { name: chat.name };
}
