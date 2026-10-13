import { createElement } from "react";
import { ImageResponse } from "next/og";
import { isAdminSession } from "@/lib/admin/auth";
import { isAspectRatio } from "@/lib/designs/layout";
import { getDesign } from "@/lib/designs/library/catalog";
import { renderDesign } from "@/lib/designs/library/render";
import { SAMPLE_PHOTO_STYLE, sampleInput } from "@/lib/designs/library/samples";
import { logError } from "@/lib/errors";

// One design of the library drawn with sample content, for the admin gallery (/admin/designs). Signed-in AAL2 admins
// only; anyone else gets a 404 like the rest of the console.
let samplePhoto: Promise<string> | undefined;

function photo(): Promise<string> {
  samplePhoto ??= new ImageResponse(createElement("div", { style: SAMPLE_PHOTO_STYLE }), { width: 900, height: 900 })
    .arrayBuffer()
    .then((png) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
  return samplePhoto;
}

export async function GET(request: Request) {
  if (!(await isAdminSession())) return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  const design = getDesign(params.get("id") ?? "");
  const ratio = params.get("ratio") ?? "1:1";
  if (!design || !isAspectRatio(ratio)) return new Response("Bad request", { status: 400 });
  const palette = Math.max(0, Math.min(3, Number(params.get("palette")) || 0));
  const withPhoto = params.get("photo") !== "0" && design.usesPhoto;
  try {
    const png = await renderDesign(design.id, sampleInput(design.fits[0], palette, withPhoto ? await photo() : null), ratio);
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
  } catch (error) {
    await logError(error, { source: "designs.admin-thumb", design: design.id });
    return new Response("Could not draw the design", { status: 500 });
  }
}
