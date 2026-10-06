import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Container, GlassCard } from "@/components/ui";
import { getAllPosts } from "@/lib/content/blog";

export const metadata = pageMetadata({
  title: "Blog",
  description: "Practical marketing advice for small business owners: what to post, how to capture leads and how to stay consistent.",
  path: "/blog",
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export default function BlogIndexPage() {
  const posts = getAllPosts();
  return (
    <>
      <PageHero eyebrow="Blog" title="Marketing tips for busy owners" text="Short, practical guides you can use this week. No jargon." />
      <Container className="pb-24">
        <ul className="grid gap-6 md:grid-cols-3">
          {posts.map((post) => (
            <li key={post.slug}>
              <GlassCard as="article" interactive className="relative flex h-full flex-col gap-3">
                <p className="flex items-center gap-2 text-sm text-muted">
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span aria-hidden>·</span>
                  <Clock aria-hidden className="size-3.5" />
                  {post.readMinutes} min read
                </p>
                <h2 className="text-xl font-bold tracking-tight">
                  <Link href={`/blog/${post.slug}`} className="after:absolute after:inset-0 after:rounded-glass after:content-['']">
                    {post.title}
                  </Link>
                </h2>
                <p className="text-muted">{post.excerpt}</p>
                <span aria-hidden className="mt-auto flex items-center gap-1.5 pt-2 font-semibold text-[color:var(--bp-link)]">
                  Read article <ArrowRight className="size-4" />
                </span>
              </GlassCard>
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
