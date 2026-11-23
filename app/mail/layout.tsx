import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "B Mail", template: "%s · B Mail" }, robots: { index: false, follow: false } };

export default function MailRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
