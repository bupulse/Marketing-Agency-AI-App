import { SERVICES } from "./service-catalog";

const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL|SIGNING/i;

/** Values of the secret-looking environment variables of every registered service (plus a few core ones). */
function secretValues(): string[] {
  const names = new Set<string>(["DATABASE_URL", "DIRECT_URL", "ENCRYPTION_KEY", "API_KEY_PEPPER", "CRON_SECRET", "BILLING_SIGNING_SECRET"]);
  for (const s of SERVICES) for (const n of [...s.env, ...(s.optionalEnv ?? [])]) names.add(n);
  const out: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length >= 6 && SECRET_NAME.test(name)) out.push(value);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Removes anything secret from text that is about to be stored or shown: the exact values of the configured secrets,
 * bearer tokens, common key shapes and secrets in URLs. Used for every health-check message.
 */
export function scrubSecrets(text: string, max = 300): string {
  let out = String(text ?? "");
  for (const secret of secretValues()) out = out.split(secret).join("[redacted]");
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|re_[A-Za-z0-9_]{16,}|pdl_[A-Za-z0-9_]{12,}|bpj_live_[A-Za-z0-9_-]{16,}|bp_live_[A-Za-z0-9_-]{16,})\b/g, "[redacted]")
    .replace(/([?&](?:key|api_key|apikey|access_token|client_secret|token|secret|code)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1[redacted]@");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}
