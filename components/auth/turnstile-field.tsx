"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile for the sign-up form. Rendered only when the server passes a site key (TURNSTILE_SITE_KEY and
// TURNSTILE_SECRET_KEY are both set); the token goes to the server action, which verifies it. Tokens are single use,
// so `resetKey` changing (a failed submit) asks for a fresh one.

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi | null> | null = null;

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function TurnstileField({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (token: string) => void; resetKey?: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenRef = useRef(onToken);
  useEffect(() => {
    tokenRef.current = onToken;
  });

  useEffect(() => {
    let cancelled = false;
    void loadTurnstile().then((api) => {
      if (cancelled || !api || !box.current || widget.current) return;
      widget.current = api.render(box.current, {
        sitekey: siteKey,
        action: "signup",
        callback: (token: string) => tokenRef.current(token),
        "expired-callback": () => tokenRef.current(""),
        "error-callback": () => tokenRef.current(""),
      });
    });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === undefined || !widget.current || !window.turnstile) return;
    tokenRef.current("");
    window.turnstile.reset(widget.current);
  }, [resetKey]);

  return <div ref={box} className="min-h-[65px]" />;
}
