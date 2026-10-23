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

/**
 * Where a refused call sends the agent (the API's answers, docs/api/support-v1.md): signed out → sign in; locked or not
 * an agent → sign in with a note; below AAL2 → the code step (which sends on to adding an app when there is none).
 * Any other refusal (a supervisor-only call, a closed chat) stays on the page as a message.
 */
export function sessionEnded(e: AgentApiError): string | null {
  if (e.status === 401) return "/sign-in?error=signed_out";
  if (e.status !== 403) return null;
  if (e.code === "locked") return "/sign-in?error=locked";
  if (e.code === "not_agent") return "/sign-in?error=no_access";
  if (e.code === "mfa_required") return "/verify";
  return null;
}

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
        const to = e instanceof AgentApiError && !preview ? sessionEnded(e) : null;
        if (to) window.location.assign(href(to));
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
