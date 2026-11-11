import "server-only";
import type { User } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { resolveCompany } from "@/lib/team/company";
import { serviceHome, serviceOf, type ServiceId } from "./app-hosts";
import { hasPicked, marketingStatus, pickedServices } from "./services-shared";

// The services a signed-in person has, for the chooser on bupulse.com/apps (docs/HOSTS.md). Phase 1: Marketing, for
// anyone with a company membership (lib/team/company.ts), and the creator portal for creators. Phase 2 adds one
// membership check here per service (Agency OS: its workspace membership) and nothing else changes.

export type ServiceCard = {
  id: ServiceId | "creator";
  name: string;
  tagline: string;
  /** Where the card opens; null for a service that is not ready yet. */
  href: string | null;
  /** The client's company, for the Marketing card. */
  company: string | null;
  /** "Free trial, 9 days left", "Standard plan"... */
  status: string | null;
};

export type ClientServices = {
  /** Cards that open something (the chooser goes straight there when there is exactly one). */
  cards: ServiceCard[];
  /** Picked at sign-up but not ready yet (Agency in phase 1): shown as "Coming soon", never opened. */
  waiting: ServiceCard[];
  /** True when the person should first pick what to start (a new account that never picked, or no service at all). */
  needsPick: boolean;
};

export async function clientServices(user: Pick<User, "id" | "user_metadata">): Promise<ClientServices> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const [company, creator] = await Promise.all([resolveCompany(user.id), prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { id: true } })]);
  const cards: ServiceCard[] = [];
  let newAccount = false;

  if (company) {
    const [business, sub] = await Promise.all([
      prisma.business.findUnique({ where: { id: company.businessId }, select: { name: true } }),
      prisma.subscription.findUnique({ where: { userId: company.ownerId }, select: { plan: true, status: true, trialEndsAt: true, planRef: { select: { name: true } } } }),
    ]);
    const m = serviceOf("marketing");
    cards.push({ id: "marketing", name: m.name, tagline: m.tagline, href: serviceHome("marketing"), company: business?.name ?? null, status: marketingStatus(sub, sub?.planRef.name ?? null) });
    // The owner of a company whose trial has not started yet is still signing up: they pick what to start first.
    newAccount = company.role === "OWNER" && sub?.status === "PENDING_DEMO";
  }
  if (creator) {
    cards.push({ id: "creator", name: "Creator portal", tagline: "Your campaigns, tasks and earnings as a content creator.", href: "/creator", company: null, status: null });
  }

  const picked = pickedServices(meta);
  const waiting = picked
    .filter((id) => !serviceOf(id).ready)
    .map((id) => ({ id, name: serviceOf(id).name, tagline: serviceOf(id).tagline, href: null, company: null, status: "Coming soon. We will email you when it is ready" }));

  const needsPick = !hasPicked(meta) && (cards.length === 0 || (newAccount && !creator));
  return { cards, waiting, needsPick };
}
