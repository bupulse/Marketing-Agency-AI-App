"use server";

import { refresh } from "next/cache";
import type { ConfirmResult } from "@/components/admin/confirm-button";
import { actionMessage, adminAction } from "@/lib/admin/console";
import { serviceInfo } from "@/lib/admin/service-catalog";
import { removeCustomKey, removeServiceKey, saveCustomKey, saveServiceKey } from "@/lib/admin/service-keys";
import { testService } from "@/lib/admin/services";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * The outcome in words for the dialog (components/admin/confirm-button.tsx): a refusal keeps it open with the reason
 * (the pasted value stays in the box); success closes it, shows the message and refreshes the page in place.
 */
async function done<T>(message: (result: T) => string | Promise<string>, fn: () => Promise<T>): Promise<ConfirmResult> {
  let out: string;
  try {
    out = await message(await fn());
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
  refresh();
  return { ok: true, message: out };
}

/** Saves one of a service's keys, then runs its Test now when every key it needs is set. */
export async function saveServiceKeyAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("system");
  return done(
    async ({ service, name }) => {
      const info = serviceInfo(service);
      const still = info.env.filter((n) => !process.env[n]);
      if (still.length) return `${name} saved. ${info.name} still needs ${still.join(", ")}.`;
      const test = await testService(ctx, service).catch(() => null);
      if (!test) return `${name} saved. Press Test now to check it.`;
      return `${name} saved. Test: ${test.ok ? "working" : "not working"}, ${test.message}`;
    },
    () => saveServiceKey(ctx, { name: text(f, "name"), value: text(f, "value") }),
  );
}

export async function removeServiceKeyAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("system");
  return done(
    (r) => (r.fallback ? `${r.name} removed here. The hosting environment's value is used again.` : `${r.name} removed. It is not set anywhere now.`),
    () => removeServiceKey(ctx, { name: text(f, "name") }),
  );
}

export async function saveCustomKeyAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("system");
  const id = text(f, "id") || undefined;
  return done(
    (r) => (r.created ? `Custom key ${r.envName} saved.` : `Custom key ${r.envName} updated.`),
    () => saveCustomKey(ctx, { id, envName: text(f, "envName"), label: text(f, "label"), details: text(f, "details"), website: text(f, "website"), value: text(f, "value") }),
  );
}

export async function removeCustomKeyAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("system");
  return done((r) => `Custom key ${r.envName} removed.`, () => removeCustomKey(ctx, { id: text(f, "id") }));
}
