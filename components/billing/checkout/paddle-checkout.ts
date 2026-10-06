import type { CheckoutConfig } from "@/lib/billing/types";

// Browser code for Paddle.js v2 (https://developer.paddle.com/paddle-js/overview).
// Everything provider-specific lives in this file; callers use openCheckout() in ./index.ts.

export const PADDLE_SCRIPT_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";

type PaddleEvent = { name?: string; error?: { detail?: string } };
type PaddleJs = {
  Environment: { set(env: "sandbox"): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleEvent) => void }): void;
  Checkout: { open(options: unknown): void };
};

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

export type CheckoutHandlers = {
  /** Checkout was closed without paying. */
  onClosed?: () => void;
  onError?: (message: string) => void;
};

let initialisedToken: string | null = null;
let handlers: CheckoutHandlers = {};

// next/script loads paddle.js after the page is interactive; wait for it rather than loading it twice.
function waitForPaddle(timeoutMs = 10_000): Promise<PaddleJs> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (window.Paddle) return resolve(window.Paddle);
      if (Date.now() - started > timeoutMs) return reject(new Error("Secure checkout could not load."));
      setTimeout(tick, 100);
    };
    tick();
  });
}

export async function openPaddleCheckout(config: CheckoutConfig, theme: "light" | "dark", next: CheckoutHandlers) {
  const paddle = await waitForPaddle();
  handlers = next;

  // Initialise once per token: the sandbox flag must be set before Initialize.
  if (initialisedToken !== config.clientToken) {
    if (config.environment === "sandbox") paddle.Environment.set("sandbox");
    paddle.Initialize({
      token: config.clientToken,
      eventCallback: (event) => {
        if (event.name === "checkout.closed") handlers.onClosed?.();
        if (event.name === "checkout.error") handlers.onError?.("Checkout ran into a problem. You were not charged.");
      },
    });
    initialisedToken = config.clientToken;
  }

  paddle.Checkout.open({
    items: [{ priceId: config.priceId, quantity: 1 }],
    // Paddle takes an existing customer id or an email, never both.
    customer: config.customerId ? { id: config.customerId } : { email: config.customerEmail },
    customData: config.customData,
    settings: { successUrl: config.successUrl, displayMode: "overlay", theme, locale: "en" },
  });
}
