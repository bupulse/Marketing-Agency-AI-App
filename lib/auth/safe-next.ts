import { afterSignInPath, nextFromUrl } from "@/lib/platform/app-hosts";

// Only same-site relative paths are allowed as post-auth redirect targets.
// Parsing against a placeholder origin catches tricks like "//evil.com", "/\\evil.com" and
// "/\t/evil.com" (browsers strip tabs and newlines, which would turn the last into //evil.com).
// One exception, once the Marketing host is on (docs/HOSTS.md): an absolute address on our own client hosts (the
// Marketing host's sign-in gate sends ?next=https://marketing.bupulse.com/posts) comes back as the app path it stands
// for (/dashboard/posts), and bupulse.com sends it on to the Marketing host. Any other address gets the fallback.
// Without a `next`, a sign-in goes to the service chooser (/apps) when the Marketing host is on, else /dashboard.
export function safeNext(value: string | null | undefined, fallback = afterSignInPath()) {
  if (!value) return fallback;
  if (!value.startsWith("/")) return nextFromUrl(value) ?? fallback;
  if (/[\x00-\x1f\x7f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://bupulse.invalid");
    if (url.origin !== "http://bupulse.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
