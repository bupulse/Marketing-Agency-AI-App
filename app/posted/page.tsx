import type { Metadata } from "next";
import { Logo } from "@/components/brand";
import { Button, GlassCard } from "@/components/ui";
import { confirmPosted } from "./actions";
import { prisma } from "@/lib/db";
import { readMarkPostedToken } from "@/lib/publishing/token";

export const metadata: Metadata = { title: "Mark as posted", robots: { index: false, follow: false } };

const NETWORK: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", twitter: "X" };

// The "I posted it" link in reminder emails. It works without signing in (the signed token proves who it is for),
// and changes nothing until the button is pressed, so email scanners that open links do no harm.
export default async function PostedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.slice(0, 400) : "";
  const postId = token ? await readMarkPostedToken(token).catch(() => null) : null;
  const post = postId ? await prisma.post.findUnique({ where: { id: postId }, select: { network: true, status: true, text: true } }) : null;
  const done = params.done === "1";
  const network = post ? (NETWORK[post.network] ?? post.network) : "";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <GlassCard strong className="flex flex-col gap-4">
        {!post ? (
          <>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">This link has expired</h1>
            <p className="text-[15px] text-muted">Open your BuPulse calendar and press &ldquo;Mark as posted&rdquo; on the post instead.</p>
            <Button href="/dashboard/calendar">Open calendar</Button>
          </>
        ) : done || post.status === "PUBLISHED" ? (
          <>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Marked as posted</h1>
            <p className="text-[15px] text-muted">Thanks. Your {network} post is now shown as published in BuPulse.</p>
            <Button href="/dashboard/calendar">Open calendar</Button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Did you post it on {network}?</h1>
            <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-2xl bg-soft p-4 text-[15px] text-muted">{post.text}</p>
            <form action={confirmPosted}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit">Yes, I posted it</Button>
            </form>
          </>
        )}
      </GlassCard>
    </main>
  );
}
