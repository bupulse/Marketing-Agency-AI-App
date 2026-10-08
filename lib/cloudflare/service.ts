import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { scriptTag } from "@/lib/widget/install";
import { defaultAllowedDomains, hostAllowed, MAX_ALLOWED_DOMAINS, normalizeDomain } from "@/lib/widget/origin";
import { CloudflareError, listZones, verifyToken, type Zone } from "./client";
import { installWidget, removeWidget } from "./zaraz";

/** A message the user can read and act on. */
export class CloudflareUserError extends Error {}

export type ZoneRow = {
  id: string;
  name: string;
  /** "installed": BuPulse added the chat and it has loaded on the site. "added": added, waiting for the first visit. */
  chat: "none" | "added" | "installed";
};

async function tokenFor(businessId: string): Promise<string> {
  const row = await prisma.cloudflareConnection.findUnique({ where: { businessId } });
  if (!row) throw new CloudflareUserError("Connect Cloudflare first.");
  return decrypt(row.tokenEncrypted);
}

/** Wraps Cloudflare errors; a rejected token flags the connection so the card asks to reconnect. */
async function guarded<T>(businessId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CloudflareError) {
      if (error.authFailed) await prisma.cloudflareConnection.updateMany({ where: { businessId }, data: { status: "NEEDS_ATTENTION" } });
      throw new CloudflareUserError(error.message);
    }
    throw error;
  }
}

/** Checks the pasted token (never stored unchecked), then keeps it encrypted. */
export async function connectCloudflare(businessId: string, rawToken: string): Promise<{ zones: number }> {
  const token = rawToken.trim();
  if (token.length < 20 || token.length > 200 || /\s/.test(token)) throw new CloudflareUserError("That does not look like a Cloudflare API token. Copy the whole token.");
  let zones: Zone[];
  try {
    if (!(await verifyToken(token))) throw new CloudflareUserError("That token is not active. Create a new one.");
    zones = await listZones(token);
  } catch (error) {
    if (error instanceof CloudflareError) {
      throw new CloudflareUserError(error.authFailed ? "Cloudflare did not accept this token. Check you copied all of it and gave it the permissions shown above." : error.message);
    }
    throw error;
  }
  const tokenEncrypted = await encrypt(token);
  await prisma.cloudflareConnection.upsert({
    where: { businessId },
    create: { businessId, tokenEncrypted },
    update: { tokenEncrypted, status: "ACTIVE" },
  });
  return { zones: zones.length };
}

/** Forgets the token. Chat widgets already installed on the sites keep working; remove them first to take them down. */
export async function disconnectCloudflare(businessId: string) {
  await prisma.cloudflareConnection.deleteMany({ where: { businessId } });
}

export async function listZoneRows(businessId: string): Promise<ZoneRow[]> {
  const token = await tokenFor(businessId);
  const [zones, installs, widget] = await Promise.all([
    guarded(businessId, () => listZones(token)),
    prisma.cloudflareInstall.findMany({ where: { businessId }, select: { zoneId: true } }),
    prisma.chatWidget.findUnique({ where: { businessId }, select: { lastSeenAt: true, lastSeenHost: true } }),
  ]);
  const installed = new Set(installs.map((i) => i.zoneId));
  return zones.map((z) => {
    if (!installed.has(z.id)) return { id: z.id, name: z.name, chat: "none" as const };
    const seen = widget?.lastSeenAt && widget.lastSeenHost && hostAllowed(widget.lastSeenHost.replace(/^www\./, ""), [z.name]);
    return { id: z.id, name: z.name, chat: seen ? ("installed" as const) : ("added" as const) };
  });
}

/** Adds the zone's domain to the chat widget's allowed websites (keeps the others; a no-op when present). */
export async function allowDomain(businessId: string, zoneName: string) {
  const domain = normalizeDomain(zoneName);
  if (!domain) return;
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { website: true } });
  const widget = await prisma.chatWidget.upsert({ where: { businessId }, create: { businessId, allowedDomains: defaultAllowedDomains(business?.website) }, update: {} });
  if (hostAllowed(domain, widget.allowedDomains)) return;
  if (widget.allowedDomains.length >= MAX_ALLOWED_DOMAINS) throw new CloudflareUserError("Your chat widget already lists the most websites allowed. Remove one in Website chat first.");
  await prisma.chatWidget.update({ where: { businessId }, data: { allowedDomains: [...widget.allowedDomains, domain] } });
}

export type InstallOutcome = { status: "installed" | "already_installed" } | { status: "manual"; reason: string };

/**
 * One-click install on a zone. Idempotent: running it twice leaves one tool in Zaraz and one entry in the allowed
 * websites. When Cloudflare refuses (token without the Zaraz permission, Zaraz not available), nothing is changed on the
 * site and the answer is "manual" so the screen shows the copy-this-code step instead.
 */
export async function installChat(businessId: string, zoneId: string): Promise<InstallOutcome> {
  const token = await tokenFor(businessId);
  const zone = (await guarded(businessId, () => listZones(token))).find((z) => z.id === zoneId);
  if (!zone) throw new CloudflareUserError("We could not find that domain in your Cloudflare account.");
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { widgetKey: true } });
  if (!business) throw new CloudflareUserError("Finish setting up your business first.");

  // Allow the domain first: if the install then fails, the manual step already works.
  await allowDomain(businessId, zone.name);
  let result: { toolId: string; changed: boolean };
  try {
    result = await installWidget(token, zone.id, scriptTag(siteUrl(), business.widgetKey), business.widgetKey);
  } catch (error) {
    if (error instanceof CloudflareError) {
      if (error.authFailed) return { status: "manual", reason: "This token cannot change Zaraz on this domain. Add the Zaraz Edit permission to the token, or copy the code below into your site." };
      return { status: "manual", reason: `Cloudflare would not apply the change (${error.message}). Copy the code below into your site instead.` };
    }
    return { status: "manual", reason: "The change could not be confirmed, so nothing was added. Copy the code below into your site instead." };
  }
  await prisma.cloudflareInstall.upsert({
    where: { businessId_zoneId: { businessId, zoneId: zone.id } },
    create: { businessId, zoneId: zone.id, zoneName: zone.name, toolId: result.toolId },
    update: { toolId: result.toolId, zoneName: zone.name },
  });
  return { status: result.changed ? "installed" : "already_installed" };
}

export async function uninstallChat(businessId: string, zoneId: string) {
  const token = await tokenFor(businessId);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { widgetKey: true } });
  if (!business) throw new CloudflareUserError("Finish setting up your business first.");
  await guarded(businessId, () => removeWidget(token, zoneId, business.widgetKey));
  await prisma.cloudflareInstall.deleteMany({ where: { businessId, zoneId } });
}
