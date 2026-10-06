"use client";

export const THEME_STORAGE_KEY = "bp-theme";

/** Runs before first paint (inline in <head>) so the right theme is applied with no flash. */
const script = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`;

// Next.js guide "Preventing flash before hydration": the script is executable in the server HTML
// (it runs while the page is parsed); when React renders the root layout in the browser (e.g. a
// notFound() page) it gets an inert text/plain copy, which React does not warn about. This must be
// a Client Component so the browser-side render really takes the text/plain branch.
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
