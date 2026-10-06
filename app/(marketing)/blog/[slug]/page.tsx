import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { Fragment } from "react";
import { Button, Container } from "@/components/ui";
import { getAllPosts, getPost } from "@/lib/content/blog";
import { site } from "@/lib/content/site";

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  const path = `/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: path },
    openGraph: { type: "article", siteName: "BuPulse", title: post.title, description: post.excerpt, url: path, publishedTime: post.date },
    twitter: { card: "summary_large_image", title: post.title, description: post.excerpt },
  };
}

/** Renders **bold** spans inside a paragraph. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

export default async function BlogPostPage({ params }: PageProps<"/blog/[slug]">) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { "@type": "Organization", name: site.name },
    publisher: { "@type": "Organization", name: site.name },
    mainEntityOfPage: `${site.url}/blog/${post.slug}`,
  };

  return (
    <Container as="article" size="narrow" className="pt-12 pb-24 sm:pt-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Link href="/blog" className="mb-8 inline-flex min-h-11 items-center gap-2 font-semibold text-[color:var(--bp-link)]">
        <ArrowLeft aria-hidden className="size-4" /> All articles
      </Link>
      <header className="mb-10 flex flex-col gap-4">
        <h1 className="text-[clamp(32px,5vw,52px)] leading-[1.08] font-bold tracking-[-0.03em]">{post.title}</h1>
        <p className="flex items-center gap-2 text-sm text-muted">
          <time dateTime={post.date}>
            {new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
          </time>
          <span aria-hidden>·</span>
          <Clock aria-hidden className="size-3.5" />
          {post.readMinutes} min read
        </p>
      </header>
      <div className="flex flex-col gap-5 text-[18px] leading-[1.8]">
        {post.body.map((block, i) =>
          block.startsWith("## ") ? (
            <h2 key={i} className="mt-6 text-2xl font-bold tracking-tight">
              {block.slice(3)}
            </h2>
          ) : (
            <p key={i}>
              <Inline text={block} />
            </p>
          ),
        )}
      </div>
      <div className="mt-14 flex flex-col items-start gap-4 border-t border-line pt-8">
        <p className="text-lg font-semibold">Want help putting this into practice?</p>
        <Button href="/login">Try BuPulse free for 7 days</Button>
      </div>
    </Container>
  );
}
