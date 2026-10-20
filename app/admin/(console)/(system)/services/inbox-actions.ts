"use server";

import { refresh } from "next/cache";
import type { ConfirmResult } from "@/components/admin/confirm-button";
import { actionMessage, adminAction } from "@/lib/admin/console";
import { setInboxTransport } from "@/lib/social/inbox/admin";
import { setInboxSetting } from "@/lib/social/inbox/settings";

// Admin -> Services, "Instagram and Facebook replies" (lib/social/inbox/admin.ts). Every change is audited.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function done<T>(message: (result: T) => string, fn: () => Promise<T>): Promise<ConfirmResult> {
  let out: string;
  try {
    out = message(await fn());
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
  refresh();
  return { ok: true, message: out };
}

export async function setInboxTransportAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("system");
  return done(
    (r) =>
      r.transport === "composio"
        ? `Replies now go through BuPulse-Socials. ${r.restarted} account ${r.restarted === 1 ? "check" : "checks"} restarted.`
        : `Replies now go through Meta direct. ${r.subscribed} ${r.subscribed === 1 ? "account" : "accounts"} subscribed to the webhook${r.failed ? `, ${r.failed} failed (see Errors)` : ""}.`,
    () => setInboxTransport(ctx, text(f, "transport")),
  );
}

export async function setInboxCapAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("system");
  return done((cap) => `Monthly limit set to ${cap.toLocaleString("en-US")} Composio calls.`, () => setInboxSetting(ctx, "monthlyCap", text(f, "monthlyCap")));
}

export async function setPrivateReplyAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("system");
  return done((on) => (on ? "Private replies are on." : "Private replies are off."), () => setInboxSetting(ctx, "privateReplyConfirmed", text(f, "privateReplyConfirmed")));
}
