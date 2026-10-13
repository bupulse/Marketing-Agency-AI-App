"use server";

import { adminAction, finish } from "@/lib/admin/console";
import {
  disconnectConnector,
  forceDisconnectChannel,
  pauseWebhook,
  resumeWebhook,
  revokeClientApiKey,
  switchOffWidget,
  switchOnWidget,
} from "@/lib/admin/actions/connections";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
// `back` is checked by finish() (kept under /admin), so a forged form cannot redirect elsewhere.
const back = (f: FormData) => text(f, "back") || "/admin/connections";

// Each action re-checks the admin first: server actions are public POST endpoints, so the layout's check is never enough.
// Submitting the confirm dialog is the confirmation (the API path needs confirm: true).

export async function forceDisconnectAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), "Account disconnected. Its posts are kept and marked as needing a reconnect.", () =>
    forceDisconnectChannel(ctx, { connectionId: text(f, "id"), reason: text(f, "reason"), confirm: true }),
  );
}

export async function disconnectConnectorAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), "Connector disconnected. Imported products and files were kept.", () =>
    disconnectConnector(ctx, { kind: text(f, "kind"), id: text(f, "id"), reason: text(f, "reason"), confirm: true }),
  );
}

export async function pauseWebhookAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), "Webhook paused.", () => pauseWebhook(ctx, { endpointId: text(f, "id"), reason: text(f, "reason"), confirm: true }));
}

export async function resumeWebhookAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), "Webhook resumed.", () => resumeWebhook(ctx, { endpointId: text(f, "id"), reason: text(f, "reason") }));
}

export async function revokeApiKeyAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), "API key revoked.", () => revokeClientApiKey(ctx, { keyId: text(f, "id"), reason: text(f, "reason"), confirm: true }));
}

export async function switchOffWidgetAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), "Website chat switched off. The owner sees it as off, with a link to contact support.", () =>
    switchOffWidget(ctx, { businessId: text(f, "id"), reason: text(f, "reason"), confirm: true }),
  );
}

export async function switchOnWidgetAction(f: FormData) {
  const ctx = await adminAction();
  await finish(back(f), "Website chat switched back on.", () => switchOnWidget(ctx, { businessId: text(f, "id") }));
}
