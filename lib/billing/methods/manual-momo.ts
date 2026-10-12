import "server-only";
import { cancelManualPayment, confirmManualPayment, rejectManualPayment, startManualPayment, submitManualProof } from "../momo";
import { getMomoSettings } from "../momo-settings";
import { momoConfigured } from "../momo-shared";
import type { PaymentMethodAdapter } from "./types";

/** Mobile Money paid by hand: the owner reads the MoMo SMS and confirms in the admin console. */
export const manualMomo: PaymentMethodAdapter = {
  method: "MANUAL_MOMO",
  provider: "MANUAL_MOMO",
  isConfigured: async () => momoConfigured(await getMomoSettings()),
  startPayment: (input) => startManualPayment(input),
  submitProof: ({ userId, ...proof }) => submitManualProof(userId, proof),
  confirm: async (ctx, paymentId) => {
    const done = await confirmManualPayment(ctx, paymentId);
    return { id: done.id, status: "confirmed" };
  },
  reject: async (ctx, paymentId, reason) => {
    const done = await rejectManualPayment(ctx, paymentId, reason);
    return { id: done.id, status: "rejected" };
  },
  // No parseWebhook: nothing calls us back. cancelManualPayment is a client-side extra, not part of the interface.
};

export { cancelManualPayment };
