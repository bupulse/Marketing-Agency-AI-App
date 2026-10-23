import "server-only";
import { prisma } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { resolveCompany } from "@/lib/team/company";

// Who is chatting, from the Supabase session cookie the widget's same-site requests carry: a client (owner or team
// member of a business), a creator, or nobody. Read-only; never creates anything. Any problem means "signed out", so a
// broken session never blocks the chat.

export type SignedInPerson = {
  userId: string;
  email: string | null;
  name: string | null;
  businessId: string | null;
  businessName: string | null;
  creatorProfileId: string | null;
};

export async function signedInPerson(): Promise<SignedInPerson | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;
    if (error || !user) return null;
    const [company, creator, profile] = await Promise.all([
      resolveCompany(user.id).catch(() => null),
      prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    ]);
    const business = company ? await prisma.business.findUnique({ where: { id: company.businessId }, select: { name: true } }) : null;
    const metaName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
    return {
      userId: user.id,
      email: user.email?.toLowerCase() ?? null,
      name: (profile?.name || creator?.name || metaName || null)?.slice(0, 120) ?? null,
      businessId: company?.businessId ?? null,
      businessName: business?.name ?? null,
      creatorProfileId: creator?.id ?? null,
    };
  } catch {
    return null;
  }
}
