// Only same-site relative paths are allowed as post-auth redirect targets.
// Parsing against a placeholder origin catches tricks like "//evil.com", "/\\evil.com" and
// "/\t/evil.com" (browsers strip tabs and newlines, which would turn the last into //evil.com).
export function safeNext(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || /[\x00-\x1f\x7f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://bupulse.invalid");
    if (url.origin !== "http://bupulse.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
