import { NextResponse, type NextRequest } from "next/server";
import { applyRepairs, findRepairs } from "@/lib/visuals/reattach";

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Called by scripts/self-host/tools/attach-ready-visuals.mjs on the PC (127.0.0.1:3002): lists the waiting posts with
// no picture whose pictures are ready (lib/visuals/reattach.ts) and, with { apply: true }, puts them on. JSON body:
// { apply?: boolean, businessId?: string }. The answer has ids, apps, states and at most 40 characters of each post.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { apply?: unknown; businessId?: unknown };
  const businessId = typeof body.businessId === "string" && body.businessId ? body.businessId : undefined;
  if (businessId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(businessId)) return NextResponse.json({ error: "That business id is not valid." }, { status: 400 });
  const repairs = await findRepairs({ businessId, limit: 1000 });
  const posts = repairs.map((r) => ({
    id: r.post.id,
    businessId: r.post.businessId,
    network: r.post.network,
    status: r.post.status,
    source: r.post.source,
    format: `${r.post.format} -> ${r.change.format}`,
    from: "contentId" in r.key ? `content ${r.key.contentId}` : `group ${r.key.groupId}`,
    media: `${r.change.mediaPaths.length} file(s)${r.video ? ", video ready" : ""}${r.images ? `, ${r.images} picture(s) ready` : ""}`,
    text: r.post.text.replace(/\s+/g, " ").slice(0, 40),
  }));
  const result = body.apply === true ? await applyRepairs(repairs) : null;
  return NextResponse.json({ apply: body.apply === true, count: posts.length, posts, result }, { headers: { "Cache-Control": "no-store" } });
}
