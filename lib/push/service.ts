import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { leadAlertMembers } from "@/lib/team/recipients";
import { sendWebPush, vapidKeysWellFormed, type VapidKeys } from "./web-push";

// Phone and browser alerts (Web Push). Free: the browsers' own push services carry them; BuPulse signs each message
// with its VAPID keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Without the keys push is simply off and
// the "Alerts on this device" switch is hidden.

/** At most this many devices per person; the oldest goes when a new one is added. */
export const MAX_DEVICES_PER_PERSON = 10;
/** A safety cap on the devices one lead alert goes to. */
const MAX_DEVICES_PER_ALERT = 50;

/** The keys from the environment, or null when push is not set up (or a key is malformed). */
export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !vapidKeysWellFormed(publicKey, privateKey)) return null;
  return { publicKey, privateKey, subject };
}

/** The public key the browser subscribes with, or null to hide the switch. */
export const pushPublicKey = (): string | null => vapidKeys()?.publicKey ?? null;

/** The push services of Chrome and Android, Firefox, Safari and iPhone, and Edge. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

/**
 * Only a browser push service may be saved as an endpoint, so a forged "subscription" can never make BuPulse post to
 * an arbitrary address. Outside production a local address is allowed too, for tests with a local receiver.
 */
export function allowedEndpoint(endpoint: string, production = process.env.NODE_ENV === "production"): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (!production && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

export type DeviceInput = { endpoint: string; keys: { p256dh: string; auth: string }; device?: string | null };

/**
 * Saves this device for the person. The same browser subscribing again (another person signing in on it, or the
 * same one after a reinstall) keeps one row, owned by the latest. Keeps at most MAX_DEVICES_PER_PERSON per person.
 */
export async function saveDevice(businessId: string, userId: string, input: DeviceInput): Promise<void> {
  const data = { businessId, userId, p256dh: input.keys.p256dh, auth: input.keys.auth, device: input.device?.slice(0, 80) || null };
  await prisma.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
  const extra = await prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES_PER_PERSON, select: { id: true } });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((d) => d.id) } } });
}

/** Turns alerts off on one device of this person. */
export async function removeDevice(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** The endpoints this person has switched on for this company, so a device can tell whether it is one of them. */
export async function deviceEndpoints(businessId: string, userId: string): Promise<string[]> {
  const rows = await prisma.pushSubscription.findMany({ where: { businessId, userId }, select: { endpoint: true }, take: MAX_DEVICES_PER_PERSON });
  return rows.map((r) => r.endpoint);
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/**
 * Sends one alert to every device that may get this company's lead alerts (leadAlertMembers), side by side. Devices
 * the push service no longer knows (404, 410) are removed; other failures are logged and the device kept. Never
 * throws. Returns how many devices accepted it.
 */
export async function pushToLeadWatchers(businessId: string, message: PushMessage): Promise<number> {
  const keys = vapidKeys();
  if (!keys) return 0;
  try {
    const devices = await prisma.pushSubscription.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: MAX_DEVICES_PER_ALERT, select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true } });
    if (devices.length === 0) return 0;
    const allowed = await leadAlertMembers(businessId);
    const targets = devices.filter((d) => allowed.has(d.userId) && allowedEndpoint(d.endpoint));
    const results = await Promise.all(
      targets.map(async (d) => {
        try {
          return { id: d.id, ...(await sendWebPush(d, message, keys)) };
        } catch (error) {
          await logError(error, { source: "push.send", level: "warn", businessId });
          return { id: d.id, ok: false, status: 0, gone: false };
        }
      }),
    );
    const gone = results.filter((r) => r.gone).map((r) => r.id);
    const sent = results.filter((r) => r.ok).map((r) => r.id);
    const refused = results.filter((r) => !r.ok && !r.gone && r.status > 0);
    if (refused.length) await logError(new Error(`Push service refused ${refused.length} alert(s): HTTP ${[...new Set(refused.map((r) => r.status))].join(", ")}`), { source: "push.send", level: "warn", businessId });
    await Promise.all([
      gone.length ? prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } }) : null,
      sent.length ? prisma.pushSubscription.updateMany({ where: { id: { in: sent } }, data: { lastSentAt: new Date() } }) : null,
    ]);
    return sent.length;
  } catch (error) {
    await logError(error, { source: "push.send", level: "warn", businessId });
    return 0;
  }
}
