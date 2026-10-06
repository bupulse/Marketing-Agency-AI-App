import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { ASPECT_RATIOS } from "@/lib/designs/layout";
import { previewTemplate } from "@/lib/designs/service";
import { TEMPLATES } from "@/lib/designs/templates/registry";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";

// Template thumbnails with the signed-in user's brand and sample text. The URL carries only the
// template and ratio, so the browser caches each one for a day instead of re-rendering it.
const query = z.object({
  template: z.string().max(40),
  ratio: z.enum(ASPECT_RATIOS).default("1:1"),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  const def = parsed.success ? TEMPLATES.find((t) => t.id === parsed.data.template) : undefined;
  if (!parsed.success || !def) return new Response("Bad request", { status: 400 });

  try {
    await rateLimit(`preview:${user.id}`, RATE_LIMITS.designPreview);
    const png = await previewTemplate(user.id, def.id, parsed.data.ratio);
    if (!png) return new Response("Not found", { status: 404 });
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
  } catch (error) {
    if (error instanceof RateLimitError) return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    await logError(error, { source: "designs.preview", userId: user.id });
    return new Response("Could not render the preview", { status: 500 });
  }
}
