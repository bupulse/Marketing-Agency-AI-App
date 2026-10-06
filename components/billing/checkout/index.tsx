"use client";

import Script from "next/script";
import type { CheckoutConfig } from "@/lib/billing/types";
import { openPaddleCheckout, PADDLE_SCRIPT_SRC, type CheckoutHandlers } from "./paddle-checkout";

/** Opens the provider's checkout. Add Stripe or PayPal here by switching on config.provider. */
export async function openCheckout(config: CheckoutConfig, theme: "light" | "dark", handlers: CheckoutHandlers = {}) {
  switch (config.provider) {
    case "PADDLE":
      return openPaddleCheckout(config, theme, handlers);
    default:
      throw new Error("This payment method is not available yet.");
  }
}

/** Loads the checkout script once. Render it on pages that can open checkout. */
export function CheckoutScript() {
  return <Script src={PADDLE_SCRIPT_SRC} strategy="afterInteractive" />;
}
