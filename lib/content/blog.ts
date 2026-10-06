// Blog posts live here until the Sanity CMS is connected.
export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO date
  readMinutes: number;
  /** Paragraphs and simple "## " headings. */
  body: string[];
}

export const posts: BlogPost[] = [];

export function getAllPosts() {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
}

export function getLatestPosts(count: number) {
  return getAllPosts().slice(0, count);
}

export function getPost(slug: string) {
  return posts.find((p) => p.slug === slug);
}
