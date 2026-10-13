import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PageLoaderLayer, PageLoaderScript } from "@/components/page-loader";
import { ThemeProvider, ThemeScript } from "@/components/theme";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "BuPulse is the AI marketing assistant for every small business: posts, videos, ads and replies in your brand voice.";

export const metadata: Metadata = {
  metadataBase: new URL("https://bupulse.com"),
  title: { default: "BuPulse: the AI marketing team for every small business", template: "%s · BuPulse" },
  description,
  applicationName: "BuPulse",
  openGraph: {
    type: "website",
    siteName: "BuPulse",
    title: "BuPulse",
    description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "BuPulse", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F5F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0F" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: ThemeScript sets class="dark" before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
        <PageLoaderScript />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-text">
        <ThemeProvider>
          <PageLoaderLayer />
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
