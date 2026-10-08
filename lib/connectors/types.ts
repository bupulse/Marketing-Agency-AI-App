// The connectors hub (Phase 7). Each connector lives in lib/connectors/entries/<id>.ts and exports
// `connector: ConnectorEntry`; the catalog page (/dashboard/connectors) only depends on these types and
// lib/connectors/catalog.ts, never on a provider's API, so connectors can be added without touching it.

export type ConnectorId = "google-drive" | "dropbox" | "canva" | "shopify" | "woocommerce" | "cloudflare";

export type ConnectorGroup = "files" | "design" | "store" | "website";

/**
 * - "connected": ready to use.
 * - "needs_attention": was connected but the token or keys stopped working; the card asks to reconnect.
 * - "not_connected": can be connected now.
 * - "unavailable": BuPulse's own app keys are not configured; the card shows "Coming soon".
 */
export type ConnectorState = "connected" | "needs_attention" | "not_connected" | "unavailable";

export interface ConnectorStatus {
  state: ConnectorState;
  /** Who or what is connected: "shop.myshopify.com", "you@gmail.com", "3 domains". */
  accountLabel?: string;
  /** Short, plain-language line under the name: "Last synced 5 minutes ago", "Token expired". */
  detail?: string;
}

export interface ConnectorEntry {
  id: ConnectorId;
  name: string;
  group: ConnectorGroup;
  /** One sentence for the card: what the client gets, not how it works. */
  description: string;
  /** lucide-react icon name (generic, no trademarked logos). */
  icon: string;
  /** Status for one business. Must be cheap: database reads only, no provider API calls. */
  status(ctx: { userId: string; businessId: string }): Promise<ConnectorStatus>;
  /** Where "Connect" goes: an OAuth start route, or a page with a short form (pasted keys, store URL). */
  connectHref: string;
  /** Where "Open" or "Manage" goes once connected (import screen, settings). */
  manageHref?: string;
  /** Removes stored tokens and keys for this business; imported files and products stay. */
  disconnect(ctx: { userId: string; businessId: string }): Promise<void>;
}
