"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import { appPathOn, hrefOn, type HostKind, type HostsConfig } from "@/lib/platform/app-hosts";

// The host the visitor is on and the configured hosts (lib/platform/app-hosts.ts), set once by the dashboard and admin
// layouts from the request, so links in the browser match the proxy: clean paths on the Marketing and admin hosts,
// absolute addresses for another host, everything unchanged while the split is off.

type Hosts = { kind: HostKind; hosts: HostsConfig };
const OFF: Hosts = { kind: "front", hosts: { marketing: null, admin: null, front: "" } };
const HostsContext = createContext<Hosts>(OFF);

export function HostsProvider({ kind, hosts, children }: Hosts & { children: ReactNode }) {
  const value = useMemo(() => ({ kind, hosts }), [kind, hosts]);
  return <HostsContext.Provider value={value}>{children}</HostsContext.Provider>;
}

export const useHosts = () => useContext(HostsContext);

/** An href for an app path from this host: useHostHref()("/dashboard/posts") is "/posts" on the Marketing host. */
export function useHostHref() {
  const { kind, hosts } = useContext(HostsContext);
  return useMemo(() => (path: string) => (hosts.front || hosts.marketing || hosts.admin ? hrefOn(kind, path, hosts) : path), [kind, hosts]);
}

/** The app path behind the address shown ("/posts" on the Marketing host is "/dashboard/posts"). */
export function useAppPath(shown: string): string {
  const { kind } = useContext(HostsContext);
  return appPathOn(kind, shown);
}

/** True when an href leaves this host (render an <a>, not a Next Link). */
export const isCrossHost = (href: string) => /^https?:\/\//i.test(href);

/**
 * A link to an app path from this host: a Next Link on the same host (clean path), a plain <a> to another host (a
 * cross-host Next Link would prefetch over CORS and fall back to a full load anyway).
 */
export function HostLink({ href, children, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const target = useHostHref()(href);
  if (isCrossHost(target)) {
    const { prefetch: _prefetch, replace: _replace, scroll: _scroll, shallow: _shallow, passHref: _passHref, legacyBehavior: _legacy, locale: _locale, onNavigate: _onNavigate, ...anchor } = rest;
    void [_prefetch, _replace, _scroll, _shallow, _passHref, _legacy, _locale, _onNavigate];
    return (
      <a href={target} {...(anchor as ComponentProps<"a">)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={target} {...rest}>
      {children}
    </Link>
  );
}
