// Checkout custom data passes through the customer's browser (Paddle.js), so it could be edited.
// The server signs the user id it puts there and the webhook only trusts a correctly signed id:
// nobody can attach their purchase (or its cancellation) to someone else's account.

const encoder = new TextEncoder();

function secret(): string {
  const value = process.env.BILLING_SIGNING_SECRET || process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("BILLING_SIGNING_SECRET (or ENCRYPTION_KEY) is not set");
  return value;
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`bupulse-checkout:${message}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function signCheckoutUser(userId: string): Promise<string> {
  return hmac(userId);
}

export async function verifyCheckoutUser(userId: string, signature: string | null | undefined): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmac(userId);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
