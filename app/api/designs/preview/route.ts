import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { ASPECT_RATIOS } from "@/lib/designs/layout";
import { previewTemplate } from "@/lib/designs/service";
import { TEMPLATES } from "@/lib/designs/templates/registry";
import { logError } from "@/lib/errors";

// Template thumbnails for the signed-in user's brand. Rendering is free, so nothing is counted.
const query = z.object({
  template: z.string().max(40),
  ratio: z.enum(ASPECT_RATIOS).default("1:1"),
  headline: z.string().trim().max(140).optional(),
  subline: z.string().trim().max(180).optional(),
  chip: z.string().trim().max(40).optional(),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  const def = parsed.success ? TEMPLATES.find((t) => t.id === parsed.data.template) : undefined;
  if (!parsed.success || !def) return new Response("Bad request", { status: 400 });

  const { ratio, headline, subline, chip } = parsed.data;
  try {
    const png = await previewTemplate(user.id, def.id, ratio, {
      headline: headline || def.fields.headline.placeholder,
      subline: subline ?? def.fields.subline.placeholder,
      chip: chip ?? def.fields.chip.placeholder,
    });
    if (!png) return new Response("Not found", { status: 404 });
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=600" } });
  } catch (error) {
    await logError(error, { source: "designs.preview", userId: user.id });
    return new Response("Could not render the preview", { status: 500 });
  }
}
