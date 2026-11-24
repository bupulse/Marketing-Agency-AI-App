import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { inlineContentType, parseRange, sandboxable } from "@/lib/mail/attachment-kinds";
import { mailUserOrNull } from "@/lib/mail/session";
import { getObject } from "@/lib/mail/storage";

// One attachment for a signed-in B Mail user who sees its mailbox. ?download=1 saves it; otherwise photos, PDFs,
// video, audio and text open in the browser (the viewer in components/mail/attachment-viewer.tsx reads the rest
// itself). Text of every kind is sent as plain text, so HTML and SVG never run as pages (lib/mail/attachment-kinds.ts).
// Video and audio players ask for byte ranges: answered from the stored file. Served by us, not a public link, so
// access is checked every time.
export const dynamic = "force-dynamic";

const SANDBOX = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await mailUserOrNull();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { id } = await ctx.params;
  const att = await prisma.mailAttachment.findFirst({ where: { id, message: { mailboxId: { in: me.mailboxIds } } }, select: { filename: true, contentType: true, path: true } });
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await getObject(att.path);
  const inlineType = inlineContentType(att.filename, att.contentType);
  const download = new URL(request.url).searchParams.get("download") === "1" || !inlineType;
  const type = download ? "application/octet-stream" : inlineType;
  const headers: Record<string, string> = {
    "content-type": type!,
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
    // Chrome's PDF viewer and the media players do not run under a sandboxing policy; everything else gets one.
    ...(download || sandboxable(inlineType) ? { "content-security-policy": SANDBOX } : {}),
  };
  const range = parseRange(request.headers.get("range"), bytes.length);
  if (range === "bad") return new NextResponse(null, { status: 416, headers: { ...headers, "content-range": `bytes */${bytes.length}` } });
  if (range) {
    return new NextResponse(Buffer.from(bytes.subarray(range.start, range.end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${bytes.length}`, "content-length": String(range.end - range.start + 1) },
    });
  }
  return new NextResponse(Buffer.from(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
}
