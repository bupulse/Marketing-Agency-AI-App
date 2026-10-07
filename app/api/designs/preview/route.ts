import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { ASPECT_RATIOS } from "@/lib/designs/layout";
import { PACKS } from "@/lib/designs/packs";
import { previewTemplate } from "@/lib/designs/service";
import { TEMPLATES } from "@/lib/designs/templates/registry";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";

// Template thumbnails with the signed-in user's brand and sample text. The URL carries only the
// template, ratio and style pack (the business's own pack when omitted), so the browser reuses each
// one for an hour and the server keeps the render in the edge cache.
const query = z.object({
  template: z.string().max(40),
  ratio: z.enum(ASPECT_RATIOS).default("1:1"),
  pack: z.enum(PACKS.map((p) => p.id) as [string, ...string[]]).optional(),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  const def = parsed.success ? TEMPLATES.find((t) => t.id === parsed.data.template) : undefined;
  if (!parsed.success || !def) return new Response("Bad request", { status: 400 });

  try {
    // Only renders count against the limit; edge-cached previews are free.
    const png = await previewTemplate(user.id, def.id, parsed.data.ratio, parsed.data.pack, () => rateLimit(`preview:${user.id}`, RATE_LIMITS.designPreview));
    if (!png) return new Response("Not found", { status: 404 });
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    if (error instanceof RateLimitError) return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    await logError(error, { source: "designs.preview", userId: user.id });
    return new Response("Could not render the preview", { status: 500 });
  }
}
