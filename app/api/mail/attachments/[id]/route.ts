import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mailUserOrNull } from "@/lib/mail/session";
import { getObject } from "@/lib/mail/storage";

// One attachment for a signed-in B Mail user who sees its mailbox. ?download=1 saves it; otherwise it opens in the
// browser (images and PDFs preview inside B Mail). Served by us, not a public link, so access is checked every time.
export const dynamic = "force-dynamic";

const PREVIEWABLE = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|text\/plain)$/i;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await mailUserOrNull();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { id } = await ctx.params;
  const att = await prisma.mailAttachment.findFirst({ where: { id, message: { mailboxId: { in: me.mailboxIds } } }, select: { filename: true, contentType: true, path: true } });
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await getObject(att.path);
  const download = new URL(request.url).searchParams.get("download") === "1" || !PREVIEWABLE.test(att.contentType);
  const name = encodeURIComponent(att.filename);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": PREVIEWABLE.test(att.contentType) ? att.contentType : "application/octet-stream",
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "x-content-type-options": "nosniff",
      // Chrome's PDF viewer does not run under a sandboxing policy; everything else gets one.
      ...(att.contentType === "application/pdf" ? {} : { "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" }),
      "cache-control": "private, max-age=300",
    },
  });
}
