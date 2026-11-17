/**
 * Who runs BuPulse, as shown on the privacy, terms and data-deletion pages and in the site footer: the company exactly as
 * on its RDB certificate (registered 17 November 2026). Meta Business Verification and App Review compare these word for
 * word with the certificate, so change them only from a new certificate, then deploy.
 */
export const LEGAL_NAME = "BuPulse LTD";
export const LEGAL_ADDRESS = "KN 84 St, Kiyovu, Nyarugenge, Kigali, Rwanda";
/** Company code / TIN from the RDB certificate. Not VAT-registered (owner, 17 Nov 2026): see lib/billing/vat.ts. */
export const LEGAL_TIN = "157384106";

/** "BuPulse LTD (TIN 157384106), KN 84 St, Kiyovu, Nyarugenge, Kigali, Rwanda" — the company as one line. */
export const LEGAL_OPERATOR = `${LEGAL_NAME} (TIN ${LEGAL_TIN}), ${LEGAL_ADDRESS}`;
