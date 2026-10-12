import "server-only";
import { disabledServices } from "@/lib/admin/switch";
import type { FeatureKey } from "@/lib/features";
import type { ConnectorEntry, ConnectorGroup, ConnectorId, ConnectorStatus } from "./types";

// The catalog for /dashboard/connectors. To add a connector: create lib/connectors/entries/<id>.ts that exports
// `connector: ConnectorEntry` and add it to ENTRIES below. Connectors without an entry yet show as "Coming soon".
import { connector as canva } from "./entries/canva";
import { connector as cloudflare } from "./entries/cloudflare";
import { connector as dropbox } from "./entries/dropbox";
import { connector as googleDrive } from "./entries/google-drive";
import { connector as shopify } from "./entries/shopify";
import { connector as woocommerce } from "./entries/woocommerce";

export const ENTRIES: ConnectorEntry[] = [googleDrive, dropbox, canva, shopify, woocommerce, cloudflare];

export const GROUPS: { id: ConnectorGroup; label: string; text: string }[] = [
  { id: "files", label: "Files", text: "Bring photos and files into your gallery." },
  { id: "design", label: "Design", text: "Use designs you already made." },
  { id: "store", label: "Store", text: "Turn your products into posts." },
  { id: "website", label: "Website", text: "Put BuPulse on your own site." },
];

/** What a card shows for a connector that has no entry yet. */
export const PLANNED: Record<ConnectorId, { name: string; group: ConnectorGroup; description: string; icon: string }> = {
  "google-drive": { name: "Google Drive", group: "files", description: "Pick photos and files from your Drive and add them to your gallery.", icon: "HardDrive" },
  dropbox: { name: "Dropbox", group: "files", description: "Pick photos and files from Dropbox and add them to your gallery.", icon: "Folder" },
  canva: { name: "Canva", group: "design", description: "Bring your Canva designs into BuPulse to use in posts.", icon: "Palette" },
  shopify: { name: "Shopify", group: "store", description: "Import your products, with photos and prices.", icon: "ShoppingBag" },
  woocommerce: { name: "WooCommerce", group: "store", description: "Import your products, with photos and prices.", icon: "ShoppingCart" },
  cloudflare: { name: "Cloudflare", group: "website", description: "See your domains and add the chat widget to your website in one click.", icon: "Globe" },
};

/** The plan feature each connector belongs to (lib/features.ts). */
export const CONNECTOR_FEATURE: Record<ConnectorId, FeatureKey> = {
  "google-drive": "driveImport",
  dropbox: "driveImport",
  canva: "canva",
  shopify: "storeImport",
  woocommerce: "storeImport",
  cloudflare: "websiteChat",
};

export type CatalogItem = {
  id: ConnectorId;
  name: string;
  group: ConnectorGroup;
  description: string;
  icon: string;
  status: ConnectorStatus;
  connectHref: string | null;
  manageHref: string | null;
};

const STATUS_TIMEOUT_MS = 5_000;
const BROKEN: ConnectorStatus = { state: "needs_attention", detail: "We could not check this connection right now. Try again in a moment." };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Every connector's status for one business, fetched in parallel. A connector that throws or is slow shows as
 * "needs attention"; it never breaks the page or the other cards. With `features` (the plan's, from
 * lib/entitlements.ts), a connector whose feature is missing shows "Add to your plan" instead of Connect.
 */
export async function getCatalog(ctx: { userId: string; businessId: string; features?: ReadonlySet<FeatureKey> }, entries: ConnectorEntry[] = ENTRIES): Promise<CatalogItem[]> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const off = await disabledServices(); // switched off in the admin console
  const ids = [...new Set<ConnectorId>([...(Object.keys(PLANNED) as ConnectorId[]), ...entries.map((e) => e.id)])];
  return Promise.all(
    ids.map(async (id): Promise<CatalogItem> => {
      const entry = byId.get(id);
      const planned = PLANNED[id];
      if (!entry) return { id, ...planned, status: { state: "unavailable" }, connectHref: null, manageHref: null };
      let status: ConnectorStatus;
      if (ctx.features && !ctx.features.has(CONNECTOR_FEATURE[id])) {
        return { id, name: entry.name, group: entry.group, description: entry.description, icon: entry.icon, status: { state: "not_in_plan", detail: "Not part of your plan yet." }, connectHref: null, manageHref: `/dashboard/upgrade?feature=${CONNECTOR_FEATURE[id]}` };
      }
      if (off.has(id)) {
        // Paused by the admin: shown as unavailable (no Connect button); nothing is disconnected or lost.
        return { id, name: entry.name, group: entry.group, description: entry.description, icon: entry.icon, status: { state: "unavailable", detail: "Temporarily unavailable. Please try again later." }, connectHref: null, manageHref: null };
      }
      try {
        status = await withTimeout(Promise.resolve().then(() => entry.status(ctx)), STATUS_TIMEOUT_MS);
      } catch (error) {
        console.error(`[connectors] status of ${id} failed:`, error instanceof Error ? error.message : error);
        status = BROKEN;
      }
      return { id, name: entry.name, group: entry.group, description: entry.description, icon: entry.icon, status, connectHref: entry.connectHref, manageHref: entry.manageHref ?? null };
    }),
  );
}

export function findEntry(id: string, entries: ConnectorEntry[] = ENTRIES): ConnectorEntry | undefined {
  return entries.find((e) => e.id === id);
}
