// support.bupulse.com/robots.txt (rewritten here by proxy.ts): nothing on the support host is for search engines.
export function GET() {
  return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
