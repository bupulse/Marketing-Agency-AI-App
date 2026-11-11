import Link from "next/link";
import { Reveal } from "@/components/motion";
import { Container } from "@/components/ui";
import { getLatestPosts } from "@/lib/content/blog";

// A photo for each article (AI photos made with the app's image model, docs/design/front-page-motion.md, round 3). An
// article without one gets a quiet brand tint, never an empty box with an icon.
const covers: Record<string, { file: string; alt: string }> = {
  "what-to-post-when-you-have-nothing-to-post": { file: "blog-photo", alt: "A boutique owner photographing a stack of colourful shirts with her phone" },
  "turn-website-visitors-into-customers-with-a-chat-widget": { file: "blog-chat", alt: "A shop owner smiling at a new customer message on his phone, a laptop beside him" },
  "a-simple-weekly-social-media-routine-for-busy-owners": { file: "blog-plan", alt: "A café owner planning her week in a notebook before opening, coffee and phone beside her" },
};

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
          {posts.map((p) => (
            <li key={p.slug} className="flex">
              <Reveal className="flex w-full">
                <Link
                  href={`/blog/${p.slug}`}
                  className="glass flex w-full flex-col overflow-hidden rounded-glass text-text no-underline transition-transform duration-300 ease-out-soft hover:-translate-y-1.5 motion-reduce:transition-none"
                >
                  {covers[p.slug] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP with srcset; next/image would add a server round trip per size
                    <img
                      src={`/marketing/photos/${covers[p.slug].file}-480.webp`}
                      srcSet={`/marketing/photos/${covers[p.slug].file}-480.webp 480w, /marketing/photos/${covers[p.slug].file}-720.webp 720w`}
                      sizes="(min-width: 768px) 380px, calc(100vw - 32px)"
                      alt={covers[p.slug].alt}
                      width={480}
                      height={270}
                      loading="lazy"
                      decoding="async"
                      className="block aspect-video h-auto w-full bg-soft object-cover"
                    />
                  ) : (
                    <div aria-hidden className="aspect-video bg-soft" />
                  )}
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
