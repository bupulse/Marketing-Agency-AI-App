"use server";

import { submitContactRequest, type ContactFormState } from "@/lib/contact";

export async function submitContactForm(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  return submitContactRequest(formData);
}
