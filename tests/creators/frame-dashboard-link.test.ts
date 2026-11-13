import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatorsFrame } from "@/components/creators/marketplace/header";
import { ThemeProvider } from "@/components/theme";

// A company signed in on the creators' public pages (bupulse.com): "Dashboard" must stay on bupulse.com once Marketing
// has its own host. QA 13 Nov: a Next Link to /dashboard prefetched a redirect to marketing.bupulse.com, which the
// browser blocks (CORS errors on /c/<slug>).
const render = () => renderToStaticMarkup(createElement(ThemeProvider, null, createElement(CreatorsFrame, { viewer: "company" } as ComponentProps<typeof CreatorsFrame>, "page")));

describe("creators frame Dashboard link", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("goes to the service chooser when Marketing has its own host", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
    vi.stubEnv("MARKETING_APP_URL", "https://marketing.bupulse.com");
    vi.stubEnv("CLIENT_COOKIE_DOMAIN", ".bupulse.com");
    expect(render()).toMatch(/href="\/apps"[^>]*>Dashboard</);
  });

  it("stays /dashboard while the split is off", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
    vi.stubEnv("MARKETING_APP_URL", "");
    vi.stubEnv("CLIENT_COOKIE_DOMAIN", "");
    expect(render()).toMatch(/href="\/dashboard"[^>]*>Dashboard</);
  });
});
