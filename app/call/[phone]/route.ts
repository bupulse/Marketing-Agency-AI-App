// The "Call" button of a Telegram lead alert (lib/lead-alerts/format.ts telegramButtons). Telegram buttons can only open
// web addresses, not "tel:", so the button opens /call/<digits> and this page hands the number to the phone's dialer at
// once, with a big link as the fallback when a browser holds the redirect back. Only a phone number is accepted, and
// nothing is stored or looked up.

const PHONE_DIGITS = /^\d{8,15}$/;

export async function GET(_request: Request, ctx: RouteContext<"/call/[phone]">) {
  const { phone } = await ctx.params;
  if (!PHONE_DIGITS.test(phone)) return new Response("Not found", { status: 404 });
  const number = `+${phone}`;
  const tel = `tel:${number}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=${tel}">
<title>Call ${number}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, -apple-system, sans-serif; background: #0b0b0f; color: #f5f5f7; }
  a { display: block; padding: 18px 28px; border-radius: 999px; background: #1f9d55; color: #fff; font-size: 20px; font-weight: 600; text-decoration: none; text-align: center; }
  p { color: #a1a1a6; text-align: center; font-size: 14px; }
</style>
</head>
<body>
<main>
  <a href="${tel}">📞 Call ${number}</a>
  <p>Your phone should start the call. If not, tap the button.</p>
</main>
<script>location.href = ${JSON.stringify(tel)};</script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}
