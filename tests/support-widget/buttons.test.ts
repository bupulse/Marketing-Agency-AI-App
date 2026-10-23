import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppButton } from "@/components/marketing/whatsapp-button";
import { Launcher } from "@/components/support-chat/launcher";

// Owner decision (23 Oct): keep both corner buttons on the public pages. The WhatsApp button (48 px) sits 12 px above
// the help chat button (60 px), on the same right edge; it hides while the chat is open; the greeting moves above both.
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the two corner buttons", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("draws the WhatsApp button only with a number, 48 px and round", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "");
    expect(renderToStaticMarkup(createElement(WhatsAppButton))).toBe("");
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "+250 700 000 000");
    const html = renderToStaticMarkup(createElement(WhatsAppButton));
    expect(html).toContain('href="https://wa.me/250700000000?text=');
    expect(html).toMatch(/class="bp-whatsapp-fab [^"]*size-12[^"]*rounded-full/);
    expect(html).toContain('aria-label="Chat with BuPulse on WhatsApp"');
  });

  it("marks the chat button, 60 px, in the same corner", () => {
    const html = renderToStaticMarkup(createElement(Launcher, { onClick: () => {} }));
    expect(html).toContain("data-support-launcher");
    expect(html).toContain("size-[60px]");
    expect(html).toContain("right-4 bottom-[calc(var(--bp-bottom-bar,0px)+1rem)] sm:right-6 sm:bottom-[calc(var(--bp-bottom-bar,0px)+1.5rem)]");
  });

  it("stacks WhatsApp 12 px above the chat button, same right edge, at every width", () => {
    expect(css).toContain(".bp-whatsapp-fab { right: 1rem; bottom: calc(var(--bp-bottom-bar, 0px) + 1rem + 60px + 12px); }");
    expect(css).toContain(".bp-whatsapp-fab { right: 1.5rem; bottom: calc(var(--bp-bottom-bar, 0px) + 1.5rem + 60px + 12px); }");
  });

  it("hides WhatsApp while the chat is open, and gives it the corner when the chat could not start", () => {
    expect(css).toContain("html[data-support-chat-open] .bp-whatsapp-fab { display: none; }");
    expect(css).toContain("html[data-support-chat-off] .bp-whatsapp-fab { bottom: calc(var(--bp-bottom-bar, 0px) + 1rem); }");
  });

  it("lifts the greeting above both buttons, and lets phone pages scroll clear of them", () => {
    expect(css).toContain("html:not([data-support-chat-off]) body:has(.bp-whatsapp-fab) { --bp-fab-stack: calc(48px + 12px); }");
    expect(css).toMatch(/@media \(width <= 480px\) \{ html:not\(\[data-support-chat-off\]\) body:has\(\.bp-whatsapp-fab\) \{ padding-bottom: calc\(1rem \+ 60px \+ 12px \+ 48px \+ 1rem\); \} \}/);
    const widget = readFileSync(new URL("../../components/support-chat/widget.tsx", import.meta.url), "utf8");
    expect(widget).toContain("var(--bp-fab-stack,0px)+5.5rem");
    expect(widget).toContain("className={cn(ABOVE_ALL,");
  });
});
