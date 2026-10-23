"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentMe } from "@/lib/support/contract";
import { createClient } from "@/lib/supabase/client";
import { AgentApiError, createAgentApi, type AgentApi } from "@/lib/support/app-client/api";
import { createMockAgentApi } from "@/lib/support/app-client/mock";
import { createLiveHub, offlineHub, type LiveHub } from "@/lib/support/app-client/realtime";
import { useSupportHref } from "./base";

// Everything the support app's screens share: the agent API (the real one, or the mock in the dev-only preview), the
// signed-in agent, and the real-time hub on the agent's own Supabase session.

type SupportApp = {
  api: AgentApi;
  me: AgentMe;
  setMe: (me: AgentMe) => void;
  hub: LiveHub;
  preview: boolean;
  /** VAPID public key for push alerts, or null when push is off. */
  pushKey: string | null;
  /** Shows a refused call's message; a 401 (signed out, locked) goes to the sign-in page. */
  fail: (e: unknown) => string;
};

const Context = createContext<SupportApp | null>(null);

export function SupportAppProvider({ me: initial, preview = false, pushKey = null, children }: { me: AgentMe; preview?: boolean; pushKey?: string | null; children: ReactNode }) {
  const [me, setMe] = useState(initial);
  const href = useSupportHref();
  const [{ api, hub }] = useState(() => {
    if (preview) return { api: createMockAgentApi({ me: initial }), hub: offlineHub() };
    const supabase = createClient();
    const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;
    return { api: createAgentApi({ getToken }), hub: createLiveHub(supabase, getToken) };
  });
  useEffect(() => () => hub.close(), [hub]);
  const value = useMemo<SupportApp>(
    () => ({
      api,
      me,
      setMe,
      hub,
      preview,
      pushKey,
      fail: (e) => {
        if (e instanceof AgentApiError && e.status === 401 && !preview) window.location.assign(href("/sign-in?error=signed_out"));
        return e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
      },
    }),
    [api, me, hub, preview, pushKey, href],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSupportApp(): SupportApp {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSupportApp must be used inside <SupportAppProvider>");
  return ctx;
}
