import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { verifyCalledToken } from "@/lib/lead-alerts/called-link";
import { cancelLeadReminders } from "@/lib/lead-alerts/reminders";

// The "✅ Called" button under a Telegram quote alert: marks the request as called (Admin -> Quote requests shows it under
// Called) and stops its reminders. Only the alert's own signed link works (called-link.ts). Pressing it twice is fine.

function page(title: string, text: string, status = 200) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, -apple-system, sans-serif; background: #0b0b0f; color: #f5f5f7; text-align: center; padding: 24px; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  p { color: #a1a1a6; font-size: 15px; margin: 0; }
</style>
</head>
<body><main><h1>${title}</h1><p>${text}</p></main></body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: Request, ctx: RouteContext<"/called/[id]">) {
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t");
  if (!/^[\w-]{10,40}$/.test(id) || !verifyCalledToken(id, token)) return page("Link not valid", "This link is not from a BuPulse alert.", 404);
  try {
    const { count } = await prisma.contactRequest.updateMany({ where: { id, kind: "quote" }, data: { handled: true } });
    if (!count) return page("Not found", "This quote request no longer exists.", 404);
    await cancelLeadReminders(id);
  } catch (error) {
    await logError(error, { source: "quote.called" });
    return page("Try again", "It could not be saved just now. Press the button again in a moment.", 500);
  }
  return page("✅ Marked as called", "The reminders have stopped. Good luck with the call!");
}
