import "server-only";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { storageByMember } from "./console-rules";
import type { SignatureCompany } from "./signature-render";

// Data the Mail console pages share: storage used (from the stored message sizes) and the company signature parts.

/** Bytes used per member (their personal mailbox) and in all mailboxes together. */
export async function loadStorage(): Promise<{ byMember: Record<string, number>; totalBytes: number }> {
  const [boxes, sums] = await Promise.all([
    prisma.mailbox.findMany({ where: { memberId: { not: null } }, select: { id: true, memberId: true } }),
    prisma.mailMessage.groupBy({ by: ["mailboxId"], _sum: { sizeBytes: true } }),
  ]);
  const rows = sums.map((s) => ({ mailboxId: s.mailboxId, bytes: s._sum.sizeBytes ?? 0 }));
  return { byMember: storageByMember(boxes, rows), totalBytes: rows.reduce((a, r) => a + r.bytes, 0) };
}

/** Sends per day for the last 7 days (oldest first, today last), as MailSendDay counts them (UTC days). */
export async function loadSendWeek(): Promise<{ day: string; sent: number }[]> {
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, i) => new Date(now - (6 - i) * 86_400_000).toISOString().slice(0, 10));
  const rows = await prisma.mailSendDay.findMany({ where: { day: { in: days } } });
  const sent = new Map(rows.map((r) => [r.day, r.sent]));
  return days.map((day) => ({ day, sent: sent.get(day) ?? 0 }));
}

/** The company parts of every signature, for previews in the console (the logo from this site). */
export async function companyForPreview(): Promise<SignatureCompany & { companyPhoneE164: string }> {
  const s = await prisma.mailSettings.findUnique({ where: { id: "default" } });
  return {
    website: s?.website ?? "bupulse.com",
    address: s?.address ?? "Kigali, Rwanda",
    companyPhone: s?.companyPhone ? formatPhone(s.companyPhone) : null,
    companyPhoneE164: s?.companyPhone ?? "",
    linkedinUrl: s?.linkedinUrl ?? null,
    instagramUrl: s?.instagramUrl ?? null,
    facebookUrl: s?.facebookUrl ?? null,
    ctaText: s?.ctaText ?? "Get your free BuPulse quote",
    ctaUrl: s?.ctaUrl ?? "https://bupulse.com/quote",
    logoUrl: "/brand/logo.png",
  };
}
