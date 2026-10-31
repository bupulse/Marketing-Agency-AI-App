"use server";

import { submitQuoteRequest } from "@/lib/quote/submit";
import type { QuoteFormState } from "@/lib/quote/schema";

export async function submitQuoteForm(_prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  return submitQuoteRequest(formData);
}
