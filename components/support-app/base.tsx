"use client";

import { createContext, useContext, type ReactNode } from "react";
import { supportHref } from "@/lib/support/app-host";

// The support app's base path: "" on support.bupulse.com, "/support" anywhere else (lib/support/app-host.ts). Set once
// by app/support/layout.tsx from the request's host, so links and redirects in the browser match the server's.

const BaseContext = createContext("/support");

export function SupportBaseProvider({ base, children }: { base: string; children: ReactNode }) {
  return <BaseContext.Provider value={base}>{children}</BaseContext.Provider>;
}

/** A path inside the support app for links: useSupportHref()("/visitors"). */
export function useSupportHref() {
  const base = useContext(BaseContext);
  return (path: string) => supportHref(base, path);
}

export const useSupportBase = () => useContext(BaseContext);
