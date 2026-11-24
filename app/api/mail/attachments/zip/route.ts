import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { mailUserOrNull } from "@/lib/mail/session";
import { getObject } from "@/lib/mail/storage";
import { zipStream } from "@/lib/mail/zip";

// "Download all (ZIP)": every file of one email (not the pictures inside its text) in one ZIP, for a signed-in B Mail
// user who sees the email's mailbox. Built here and streamed one file at a time (lib/mail/zip.ts).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const me = await mailUserOrNull();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("message") ?? "";
  const msg = id
    ? await prisma.mailMessage.findFirst({
        where: { id, mailboxId: { in: me.mailboxIds } },
        select: { subject: true, date: true, attachments: { where: { inline: false }, orderBy: { createdAt: "asc" }, select: { filename: true, path: true } } },
      })
    : null;
  if (!msg || msg.attachments.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const stream = zipStream(msg.attachments.map((a) => ({ name: a.filename, date: msg.date, bytes: () => getObject(a.path) })));
  // A file that cannot be read mid-way breaks the download (the browser shows it failed) and is logged.
  const reader = stream.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = await reader.read();
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      } catch (error) {
        await logError(error, { source: "mail.attachments.zip", level: "warn" });
        controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const name = `${(msg.subject || "attachments").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "attachments"}.zip`;
  return new NextResponse(body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
