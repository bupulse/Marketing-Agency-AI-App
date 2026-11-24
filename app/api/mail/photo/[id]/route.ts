import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/mail/storage";
import { imageKind } from "@/lib/mail/photo";

// A team member's profile photo, public on purpose: it is shown next to their emails and in their signature, so
// Gmail and other mail apps must be able to load it. Only photos people chose to add; the id is the member's own.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[\w-]{3,64}$/.test(id)) return new NextResponse(null, { status: 404 });
  const member = await prisma.mailMember.findUnique({ where: { id }, select: { photoPath: true, status: true } });
  if (!member?.photoPath || member.status === "suspended") return new NextResponse(null, { status: 404 });
  const bytes = await getObject(member.photoPath).catch(() => null);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": imageKind(bytes) ?? "image/jpeg",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      // The link changes (?v=) whenever the photo changes, so it may be kept for a long time.
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
