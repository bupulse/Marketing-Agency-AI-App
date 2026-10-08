import type { Metadata } from "next";
import type { ReactNode } from "react";

// Every admin page reads the session, so none is cached or indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · BuPulse admin" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return children;
}
