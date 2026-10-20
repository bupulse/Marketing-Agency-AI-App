"use server";

import { submitPartnerApplication } from "@/lib/partners/service";
import type { PartnerFormState } from "@/lib/partners/shared";

// Public: rate-limited per address and email, honeypot, zod (lib/partners/service.ts). Stored for the admin only.
export async function applyPartnerAction(_prev: PartnerFormState, formData: FormData): Promise<PartnerFormState> {
  return submitPartnerApplication(formData);
}
