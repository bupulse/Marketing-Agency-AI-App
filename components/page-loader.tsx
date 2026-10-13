"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { isPageLoader, PAGE_LOADER_STORAGE_KEY, type PageLoader } from "@/lib/ui/page-loader";

// Site-wide page-loading animation (Admin -> Settings -> Loading animation): a thin branded bar across the top, or the
// BuPulse preloader (logo with a spinning ring), or nothing. It starts when a link to another page is clicked and ends
// when the new page is on screen. With "preloader" the first paint of a full page load is covered too (see
// PageLoaderScript), until the page has loaded.

/** Runs before the page paints: shows the preloader during a full page load when that is the saved choice. */
export function PageLoaderScript() {
  const code = `try{if(localStorage.getItem(${JSON.stringify(PAGE_LOADER_STORAGE_KEY)})==="preloader")document.documentElement.classList.add("bp-preloading")}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

function readSaved(): PageLoader {
  try {
    const v = localStorage.getItem(PAGE_LOADER_STORAGE_KEY);
    return isPageLoader(v) ? v : "bar";
  } catch {
    return "bar";
  }
}

/** A click that will make the app router load another page (same site, same tab, a different path or query). */
function startsNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || !a.href || a.hasAttribute("download") || (a.target && a.target !== "_self")) return false;
  const to = new URL(a.href, location.href);
  if (to.origin !== location.origin) return false;
  return to.pathname !== location.pathname || to.search !== location.search;
}

function Loader() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}?${search}`;
  // The saved choice first (nothing is rendered until a click, so server and browser agree), then the server's.
  const [mode, setMode] = useState<PageLoader>(readSaved);
  // The page a navigation started from: the loader shows while that page is still on screen.
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ui")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pageLoader?: unknown } | null) => {
        if (!d || !isPageLoader(d.pageLoader)) return;
        setMode(d.pageLoader);
        try {
          localStorage.setItem(PAGE_LOADER_STORAGE_KEY, d.pageLoader);
        } catch {}
      })
      .catch(() => {});
    // The full-page-load preloader ends once this page is ready.
    const root = document.documentElement;
    if (root.classList.contains("bp-preloading")) {
      const end = () => setTimeout(() => root.classList.remove("bp-preloading"), 150);
      if (document.readyState === "complete") end();
      else window.addEventListener("load", end, { once: true });
    }
  }, []);

  useEffect(() => {
    let safety: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (!startsNavigation(e)) return;
      setFrom(`${location.pathname}?${new URLSearchParams(location.search).toString()}`); // the same shape as `here`
      clearTimeout(safety);
      safety = setTimeout(() => setFrom(null), 15_000); // never stuck on a failed navigation
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(safety);
    };
  }, []);

  // Done as soon as the address changes: the new page is on screen.
  if (mode === "off" || from === null || from !== here) return null;
  if (mode === "bar") {
    return (
      <div role="progressbar" aria-label="Loading page" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
        <div className="bp-loader-bar h-full bg-brand-gradient shadow-[0_0_10px_#5b6bff]" />
      </div>
    );
  }
  return <Preloader />;
}

/** The branded preloader: the BuPulse mark inside a spinning gradient ring, on the page background (no blur). */
export function Preloader({ id }: { id?: string }) {
  return (
    <div
      id={id}
      role="status"
      aria-label="Loading"
      className="bp-preloader fixed inset-0 z-[100] items-center justify-center bg-bg"
    >
      <div className="relative grid size-20 place-items-center">
        <span aria-hidden className="bp-preloader-ring absolute inset-0 rounded-full" />
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static mark, shown before images load */}
        <img src="/brand/mark.png" alt="" width={40} height={40} className="bp-preloader-mark size-10" />
      </div>
    </div>
  );
}

export function PageLoaderLayer() {
  return (
    <>
      {/* Shown only while <html> has bp-preloading (full page load with the preloader chosen). */}
      <Preloader id="bp-first-load" />
      <Suspense fallback={null}>
        <Loader />
      </Suspense>
    </>
  );
}
