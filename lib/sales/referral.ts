import "server-only";
// Referral links of sales staff: any page of the site with ?ref=CODE. proxy.ts keeps the first code a visitor arrives
// with in a 30-day cookie (./ref-cookie.ts); sign-up (lib/account.ts) gives the new company to that agent.
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/auth/site-url";
import { REF_ALPHABET, isSalesRole, normalizeRef, permissionsOf } from "@/lib/staff/permissions";
import { REF_COOKIE } from "./ref-cookie";

const CODE_LENGTH = 5;
const TRIES = 8;

export function randomRefCode(length = CODE_LENGTH): string {
  return Array.from({ length }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("");
}

const isUniqueError = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** The staff member's referral code, made on first use: random, unique, retried on a collision. */
export async function ensureRefCode(staffId: string): Promise<string> {
  const staff = await prisma.staffMember.findUnique({ where: { id: staffId }, select: { refCode: true } });
  if (!staff) throw new Error("Staff member not found");
  if (staff.refCode) return staff.refCode;
  for (let i = 0; i < TRIES; i++) {
    // Longer codes after a few collisions, so a crowded space still finds a free one.
    const code = randomRefCode(i < 4 ? CODE_LENGTH : CODE_LENGTH + 1);
    try {
      // refCode: null in the filter: two first views at once keep whichever code was written first.
      const { count } = await prisma.staffMember.updateMany({ where: { id: staffId, refCode: null }, data: { refCode: code } });
      if (count) return code;
      const now = await prisma.staffMember.findUnique({ where: { id: staffId }, select: { refCode: true } });
      if (now?.refCode) return now.refCode;
    } catch (e) {
      if (!isUniqueError(e)) throw e;
    }
  }
  throw new Error("Could not make a unique referral code");
}

/** The full link for a code on a page of the site (default the home page). */
export function refUrl(code: string, path = "/"): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, siteUrl());
  url.searchParams.set("ref", code);
  return url.toString();
}

/**
 * Gives a new company to the agent whose code the visitor came with, when that code belongs to a sales staff member
 * who is not disabled: Business.salesAgentId and an open ClientAssignment (source "referral"). Never throws: a
 * sign-up must not fail because of a referral. Returns the agent's id, or null.
 */
export async function assignReferral(input: { businessId: string; userId: string; email?: string | null; code: string | null | undefined; at?: Date }): Promise<string | null> {
  const code = normalizeRef(input.code);
  if (!code) return null;
  try {
    const staff = await prisma.staffMember.findUnique({ where: { refCode: code }, select: { id: true, status: true, roleKey: true, userId: true, email: true } });
    if (!staff || staff.status === "disabled") return null;
    // No self-referral: an agent signing up a company with their own account (or address) does not get it.
    if (staff.userId === input.userId || (input.email && staff.email === input.email.trim().toLowerCase())) return null;
    const role = await prisma.staffRole.findUnique({ where: { key: staff.roleKey }, select: { key: true, permissions: true } }).catch(() => null);
    if (!isSalesRole(staff.roleKey, permissionsOf(staff.roleKey, role ? [role] : []))) return null;
    const at = input.at ?? new Date();
    await prisma.$transaction(async (tx) => {
      // Only a company nobody has yet: an assignment made some other way is never replaced by a link.
      const { count } = await tx.business.updateMany({ where: { id: input.businessId, salesAgentId: null }, data: { salesAgentId: staff.id } });
      if (!count) throw new Error("already assigned");
      await tx.clientAssignment.create({ data: { businessId: input.businessId, userId: input.userId, staffId: staff.id, startsAt: at, source: "referral", by: "referral" } });
    });
    return staff.id;
  } catch {
    return null;
  }
}

/** The referral code in the request's cookie, or null (outside a request, or none). */
export async function refFromCookie(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    return normalizeRef((await cookies()).get(REF_COOKIE)?.value);
  } catch {
    return null;
  }
}
