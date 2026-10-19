import "server-only";
import { prisma } from "@/lib/db";
import { isServiceEnabled } from "@/lib/admin/switch";
import { siteUrl } from "@/lib/auth/site-url";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { alertRecipients } from "@/lib/team/recipients";

// "Your video is ready" (docs/VIDEO_STUDIO_SPLIT.md): run by the video-jobs cron. Each studio video that became ready
// gets one email to the company (the Owner, and Admins with alerts on), with a button to it in the Videos library.
// Videos made in one go are sent together. A video the client already opened in the library is not emailed. Only
// videos from the last NOTICE_WINDOW_MS count, so switching this on never emails an old backlog.

export const NOTICE_WINDOW_MS = 2 * 24 * 60 * 60_000;
const BATCH = 100;

export type NoticeResult = { companies: number; videos: number; emails: number; waiting?: "resend_off" };

export async function sendReadyNotices(now = new Date()): Promise<NoticeResult> {
  // Switched off in the admin console: wait (nothing is claimed), so the emails go out once it is back on.
  if (!(await isServiceEnabled("resend"))) return { companies: 0, videos: 0, emails: 0, waiting: "resend_off" };
  const since = new Date(now.getTime() - NOTICE_WINDOW_MS);
  const due = await prisma.videoJob.findMany({
    where: { status: "ready", videoPath: { not: null }, readyNoticeAt: null, seenAt: null, updatedAt: { gte: since } },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
    select: { id: true, businessId: true },
  });
  const byCompany = new Map<string, string[]>();
  for (const j of due) byCompany.set(j.businessId, [...(byCompany.get(j.businessId) ?? []), j.id]);

  const result: NoticeResult = { companies: 0, videos: 0, emails: 0 };
  for (const [businessId, ids] of byCompany) {
    // Claimed first (a conditional update), so two sweeps at once never email the same video twice.
    const { count } = await prisma.videoJob.updateMany({ where: { id: { in: ids }, readyNoticeAt: null }, data: { readyNoticeAt: now } });
    if (count === 0) continue;
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, user: { select: { email: true } } } });
    if (!business) continue;
    const to = await alertRecipients(businessId, business.user.email);
    const first = ids.length === 1 ? await prisma.videoJob.findUnique({ where: { id: ids[0] }, select: { product: { select: { name: true } } } }) : null;
    const email = readyEmail({ count, businessName: business.name, productName: first?.product?.name ?? null, href: `${siteUrl()}/dashboard/video${count === 1 ? `?v=${ids[0]}` : ""}` });
    let sent = 0;
    for (const address of to) if (await sendEmail({ to: address, ...email })) sent += 1;
    result.companies += 1;
    result.videos += count;
    result.emails += sent;
  }
  return result;
}

/** The email itself (pure, for the tests). */
export function readyEmail(input: { count: number; businessName: string; productName: string | null; href: string }): { subject: string; html: string; text: string } {
  const one = input.count === 1;
  const subject = one ? `Your video${input.productName ? ` for ${input.productName}` : ""} is ready` : `${input.count} new videos are ready`;
  const body = renderEmail({
    heading: subject,
    intro: one
      ? `The Video Studio finished a video for ${input.businessName}. It is in your Videos library: watch it, download it or schedule it on your channels.`
      : `The Video Studio finished ${input.count} videos for ${input.businessName}. They are in your Videos library: watch them, download them or schedule them on your channels.`,
    button: { label: one ? "View video" : "View videos", url: input.href },
    footer: "You get this email when a video you asked for is ready.",
  });
  return { subject, ...body };
}
