import Link from "next/link";
import { Reveal } from "@/components/motion";
import { Container } from "@/components/ui";
import { getLatestPosts } from "@/lib/content/blog";

const covers = [
  "linear-gradient(135deg, rgba(47,107,255,.35), rgba(123,92,255,.35))",
  "linear-gradient(135deg, rgba(123,92,255,.35), rgba(47,107,255,.35))",
];

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function BlogTeaser() {
  const posts = getLatestPosts(3);
  if (posts.length === 0) return null;
  return (
    <section id="blog" aria-labelledby="blog-title" className="scroll-mt-28 py-16">
      <Container>
        <Reveal>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <h2 id="blog-title" className="m-0 text-[clamp(30px,4vw,48px)] leading-[1.08] font-bold tracking-[-0.03em]">
              Marketing tips for owners
            </h2>
            <Link href="/blog" className="inline-flex min-h-11 items-center font-semibold">
              All articles
            </Link>
          </div>
        </Reveal>
        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-3">
          {posts.map((p, i) => (
            <li key={p.slug} className="flex">
              <Reveal className="flex w-full">
                <Link
                  href={`/blog/${p.slug}`}
                  className="glass flex w-full flex-col overflow-hidden rounded-glass text-text no-underline transition-transform duration-300 ease-out-soft hover:-translate-y-1.5 motion-reduce:transition-none"
                >
                  <div aria-hidden className="h-[150px]" style={{ background: covers[i % covers.length] }} />
                  <div className="flex flex-col gap-2 px-[22px] pt-5 pb-6">
                    <span className="text-xs text-muted">
                      {dateFormat.format(new Date(p.date))} · {p.readMinutes} min read
                    </span>
                    <strong className="text-lg leading-snug">{p.title}</strong>
                    <span className="text-sm leading-relaxed text-muted">{p.excerpt}</span>
                  </div>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
