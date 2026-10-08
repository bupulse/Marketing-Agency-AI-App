// The public shapes of the REST API (docs/API.md). Fields are listed one by one, so adding a column to the
// database never leaks it, and private storage paths are never exposed.

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function projectJson(p: { id: string; type: string; title: string; price: string | null; features: string[]; photoPaths: string[]; createdAt: Date; updatedAt: Date }) {
  return { id: p.id, type: p.type, title: p.title, price: p.price, features: p.features, photoCount: p.photoPaths.length, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) };
}

export function contentJson(c: { id: string; projectId: string; caption: string; hashtags: string[]; videoScript: string; adHeadlines: string[]; language: string; edited: boolean; createdAt: Date }) {
  return { id: c.id, projectId: c.projectId, caption: c.caption, hashtags: c.hashtags, videoScript: c.videoScript, adHeadlines: c.adHeadlines, language: c.language, edited: c.edited, createdAt: iso(c.createdAt) };
}

export function postJson(p: { id: string; network: string; status: string; format: string; projectId: string | null; contentId: string | null; title: string | null; text: string; hashtags: string[]; link: string | null; mediaPaths: string[]; scheduledAt: Date | null; publishedAt: Date | null; permalink: string | null; lastError: string | null; createdAt: Date }) {
  return {
    id: p.id,
    network: p.network,
    status: p.status.toLowerCase(),
    format: p.format.toLowerCase(),
    projectId: p.projectId,
    contentId: p.contentId,
    title: p.title,
    text: p.text,
    hashtags: p.hashtags,
    link: p.link,
    mediaCount: p.mediaPaths.length,
    scheduledAt: iso(p.scheduledAt),
    publishedAt: iso(p.publishedAt),
    permalink: p.permalink,
    error: p.lastError,
    createdAt: iso(p.createdAt),
  };
}

export function leadJson(l: { id: string; name: string | null; email: string | null; phone: string | null; interest: string | null; message: string | null; source: string; status: string; notes: string | null; pageUrl: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: l.id, name: l.name, email: l.email, phone: l.phone, interest: l.interest, message: l.message, source: l.source, status: l.status.toLowerCase(), notes: l.notes, pageUrl: l.pageUrl, createdAt: iso(l.createdAt), updatedAt: iso(l.updatedAt) };
}
