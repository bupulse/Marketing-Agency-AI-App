import type { BillingInterval, BillingProvider } from "@/lib/generated/prisma/client";
import type { AdminContext } from "@/lib/admin/types";
import type { ManualPaymentView, ProofInput } from "../momo-shared";

/**
 * A way to pay other than the card checkout (`BillingAdapter`, which Paddle implements): the client starts a payment,
 * proves it, and someone or something confirms it. Manual Mobile Money is the first; an automatic provider (Paypack,
 * Flutterwave, MTN) implements the same interface and confirms from its webhook instead of the admin console.
 * See docs/MOMO.md, "Adding an automatic provider".
 */
export type PaymentMethodKey = "MANUAL_MOMO";

export type StartPaymentInput = { userId: string; plan: string; interval: BillingInterval };
export type SubmitProofInput = { userId: string } & ProofInput;

/** A verified provider webhook, translated to what BuPulse needs to do with a payment. */
export type PaymentWebhook = {
  eventId: string;
  type: string;
  /** Our reference (BP-XXXX) the provider echoes back, when the event is about one payment. */
  reference: string | null;
  outcome: "confirmed" | "rejected" | "ignored";
  reason?: string;
  payload: unknown;
};

export interface PaymentMethodAdapter {
  method: PaymentMethodKey;
  /** The BillingProvider written on the subscription when a payment is confirmed. */
  provider: BillingProvider;
  /** Whether clients can be offered this method right now (owner details filled in, keys present). */
  isConfigured(): Promise<boolean>;
  /** Creates a pending payment and what the client needs to pay (amount, reference, where to pay). */
  startPayment(input: StartPaymentInput): Promise<ManualPaymentView>;
  /** The client says they paid: records the proof and alerts whoever confirms. */
  submitProof(input: SubmitProofInput): Promise<ManualPaymentView>;
  /** Marks the payment paid and writes the period onto the subscription. Manual: the owner in the console. */
  confirm(ctx: AdminContext, paymentId: string): Promise<{ id: string; status: "confirmed" }>;
  reject(ctx: AdminContext, paymentId: string, reason: string): Promise<{ id: string; status: "rejected" }>;
  /**
   * Automatic providers only: verifies the signature and reads the event; null when the request is not genuine.
   * The route /api/billing/webhooks/[provider] calls it. The manual method has no webhook.
   */
  parseWebhook?(rawBody: string, headers: Headers): Promise<PaymentWebhook | null>;
}
