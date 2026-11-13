"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const subscribe = (query: string) => (cb: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** A media query's answer; `server` while rendering on the server. */
export function useMedia(query: string, server = false): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => server,
  );
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)", false);
/** A mouse or trackpad (hover previews and tilt); phones get tap to play. */
export const useFinePointer = () => useMedia("(hover: hover) and (pointer: fine)", false);

/**
 * The pointer effects of the samples site: the gradient border follows the pointer (--mx/--my on the card), the light
 * on the glass panel follows it too (--gx/--gy on `glass`), and the card tilts a little. Mouse only, never with reduced
 * motion. Written with requestAnimationFrame, transform only.
 */
export function usePointerFx(card: RefObject<HTMLElement | null>, glass?: RefObject<HTMLElement | null>, opts: { tilt?: number; lift?: number } = {}) {
  const fine = useFinePointer();
  const calm = useReducedMotion();
  const tilt = opts.tilt ?? 5;
  const lift = opts.lift ?? 6;
  useEffect(() => {
    const el = card.current;
    if (!el || !fine) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
        const g = glass?.current;
        if (g) {
          const gr = g.getBoundingClientRect();
          g.style.setProperty("--gx", `${e.clientX - gr.left}px`);
          g.style.setProperty("--gy", `${e.clientY - gr.top}px`);
        }
        if (!calm && tilt) el.style.transform = `perspective(1000px) rotateY(${(x - 0.5) * tilt}deg) rotateX(${(0.5 - y) * tilt}deg) translateY(-${lift}px) scale(1.015)`;
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = "";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.style.transform = "";
    };
  }, [card, glass, fine, calm, tilt, lift]);
}

/** True once the element has come into view (for the rise-in), and whether it is in view now (to pause previews). */
export function useInView(ref: RefObject<HTMLElement | null>, margin = "0px 0px -6% 0px") {
  const [state, setState] = useState({ seen: false, now: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setState({ seen: true, now: true });
      return;
    }
    const io = new IntersectionObserver(([e]) => setState((s) => ({ seen: s.seen || e.isIntersecting, now: e.isIntersecting })), { rootMargin: margin, threshold: 0.06 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return state;
}

/**
 * A dialog's housekeeping: Esc and the keys in `keys` call their handlers, Tab stays inside, the page behind does not
 * scroll, and focus goes back to where it was when the dialog closes.
 */
export function useDialog(open: boolean, root: RefObject<HTMLElement | null>, keys: Record<string, (e: KeyboardEvent) => void>) {
  const keysRef = useRef(keys);
  useEffect(() => {
    keysRef.current = keys;
  });
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    const t = window.setTimeout(() => root.current?.focus({ preventScroll: true }), 0);
    const onKey = (e: KeyboardEvent) => {
      // A native <dialog> opened on top (Schedule) handles its own keys.
      if (e.defaultPrevented || [...document.querySelectorAll("dialog[open]")].some((d) => !root.current?.contains(d))) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest("input:not([type=range]), textarea, select, [contenteditable=true]");
      if (e.key === "Tab" && root.current) {
        const list = [...root.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null || x === document.activeElement);
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (typing && e.key !== "Escape") return;
      const fn = keysRef.current[e.key] ?? keysRef.current[e.key.toLowerCase()];
      if (fn) fn(e);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      html.style.overflow = overflow;
      before?.focus?.({ preventScroll: true });
    };
  }, [open, root]);
}

/** A swipe on a touch screen: calls back with the direction once the finger moved far enough. */
export function useSwipe(ref: RefObject<HTMLElement | null>, on: (dir: "left" | "right" | "up" | "down") => void, min = 60) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x = 0;
    let y = 0;
    let active = false;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      active = !(e.target as HTMLElement).closest("input, [data-no-swipe]");
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    };
    const end = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x;
      const dy = t.clientY - y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return;
      if (Math.abs(dx) > Math.abs(dy)) on(dx < 0 ? "left" : "right");
      else on(dy < 0 ? "up" : "down");
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchend", end);
    };
  }, [ref, on, min]);
}
