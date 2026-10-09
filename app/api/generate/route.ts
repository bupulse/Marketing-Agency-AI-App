import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/ai/types";
import { resolveCompany } from "@/lib/team/company";
import { getCurrentUser } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { MAX_PROJECTS_PER_BUSINESS, projectInputSchema } from "@/lib/studio/schemas";
import { generateForProject } from "@/lib/studio/service";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";

// Creates a project and generates its caption, hashtags, video script and ad headlines.
// Costs 1 text generation from the user's plan. Body: the project fields (type, title, price,
// features, details, photoPaths); `extraDetails` is accepted as an alias of `details`.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Teammates work on the company account: its projects, its Storage folder and its credits.
  const company = await resolveCompany(user.id);
  const companyId = company?.ownerId ?? user.id;

  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const parsed = projectInputSchema(companyId)
    .extend({ type: z.string().trim().toLowerCase().min(1).max(40).default("product") })
    .safeParse(body && { ...body, details: body.details ?? body.extraDetails });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { details, ...input } = parsed.data;

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true } });
  if (account?.deletionScheduledFor || account?.suspendedAt || company?.ownerDeleting || company?.ownerSuspended) return NextResponse.json({ error: "account_locked" }, { status: 403 });

  try {
    await rateLimit(`project:${companyId}`, RATE_LIMITS.projectCreate);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: "rate_limited", message: rateLimitMessage(error) },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }

  const business = await prisma.business.findUnique({ where: { userId: companyId }, select: { id: true } });
  if (!business) return NextResponse.json({ error: "Business profile not found" }, { status: 409 });
  if ((await prisma.project.count({ where: { businessId: business.id } })) >= MAX_PROJECTS_PER_BUSINESS) {
    return NextResponse.json({ error: "project_limit", message: "Project limit reached." }, { status: 409 });
  }

  // Reserve the credit first, so a blocked call leaves no project behind.
  let reservation;
  try {
    reservation = await consumeUsage(companyId, "text");
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return NextResponse.json({ error: "usage_blocked", reason: error.reason }, { status: 402 });
    }
    throw error;
  }

  let projectId: string;
  try {
    const project = await prisma.project.create({
      data: { ...input, businessId: business.id, details: details ? { notes: details } : undefined },
      select: { id: true },
    });
    projectId = project.id;
  } catch (error) {
    await refundUsage(companyId, "text", reservation.periodStart).catch(() => {});
    throw error;
  }

  try {
    const content = await generateForProject({
      userId: companyId,
      businessId: business.id,
      projectId,
      feature: "content",
      reservation,
    });
    return NextResponse.json({ projectId, content });
  } catch (error) {
    if (error instanceof AIProviderError) {
      return NextResponse.json(
        { error: "ai_failed", message: error.message, retryable: error.retryable, projectId },
        { status: 502 },
      );
    }
    console.error("Generation failed", error);
    return NextResponse.json(
      { error: "server_error", message: "Content generation is not available right now.", projectId },
      { status: 500 },
    );
  }
}
