export const THEME_STORAGE_KEY = "bp-theme";

/** Runs before first paint (inline in <head>) so the right theme is applied with no flash. */
const script = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`;

// React warns when a client render produces an executable <script>. Following the Next.js guide
// ("Preventing flash before hydration"), the script is executable only in the server HTML; any
// client render gets an inert text/plain copy. suppressHydrationWarning covers the type difference.
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
