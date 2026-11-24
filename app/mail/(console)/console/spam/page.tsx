import { SpamView } from "@/components/mail/console-spam";
import { prisma } from "@/lib/db";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Spam and blocks" };

export default async function MailConsoleSpamPage() {
  await requireMailAdmin();
  const [rules, settings] = await Promise.all([
    prisma.mailSenderRule.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, pattern: true, action: true, createdBy: true, createdAt: true } }),
    prisma.mailSettings.findUnique({ where: { id: "default" }, select: { catchAll: true } }),
  ]);
  return <SpamView rules={rules.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} catchAll={settings?.catchAll ?? "other"} />;
}
