import { siteUrl } from "@/lib/auth/site-url";

export const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
export const CANVA_API = "https://api.canva.com/rest/v1";
export const CANVA_TOKEN_URL = `${CANVA_API}/oauth/token`;
export const CANVA_REVOKE_URL = `${CANVA_API}/oauth/revoke`;
export const CANVA_KEYS_URL = `${CANVA_API}/connect/keys`;

/**
 * asset:write uploads the design PNG, design:content:write creates the Canva design, design:content:read exports it,
 * design:meta:read lists the user's designs for "Import from Canva". (GET /users/me needs no scope.)
 */
export const CANVA_SCOPES = ["asset:write", "design:content:write", "design:content:read", "design:meta:read"];

/** The feature is hidden everywhere when no client id is configured. */
export function isCanvaEnabled(): boolean {
  return !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET;
}

export function canvaConfig() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("CANVA_CLIENT_ID and CANVA_CLIENT_SECRET are not set");
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.CANVA_REDIRECT_URI || `${siteUrl()}/api/canva/callback`,
  };
}
