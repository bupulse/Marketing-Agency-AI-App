import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/ai/types";
import { getCurrentUser } from "@/lib/supabase/server";
import { projectInputSchema } from "@/lib/studio/schemas";
import { generateForProject } from "@/lib/studio/service";
import { UsageLimitError } from "@/lib/usage";

// Creates a project and generates its caption, hashtags, video script and ad headlines.
// Costs 1 text generation from the user's plan. Body: the project fields (type, title, price,
// features, details, photoPaths); `extraDetails` is accepted as an alias of `details`.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const parsed = projectInputSchema(user.id)
    .extend({ type: z.string().trim().toLowerCase().min(1).max(40).default("product") })
    .safeParse(body && { ...body, details: body.details ?? body.extraDetails });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { details, ...input } = parsed.data;

  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return NextResponse.json({ error: "Business profile not found" }, { status: 409 });

  const project = await prisma.project.create({
    data: { ...input, businessId: business.id, details: details ? { notes: details } : undefined },
    select: { id: true },
  });

  try {
    const content = await generateForProject({
      userId: user.id,
      businessId: business.id,
      projectId: project.id,
      feature: "content",
    });
    return NextResponse.json({ projectId: project.id, content });
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return NextResponse.json({ error: "usage_blocked", reason: error.reason, projectId: project.id }, { status: 402 });
    }
    if (error instanceof AIProviderError) {
      return NextResponse.json(
        { error: "ai_failed", message: error.message, retryable: error.retryable, projectId: project.id },
        { status: 502 },
      );
    }
    console.error("Generation failed", error);
    return NextResponse.json(
      { error: "server_error", message: "Content generation is not available right now.", projectId: project.id },
      { status: 500 },
    );
  }
}
