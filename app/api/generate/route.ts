import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getTextProvider, AIProviderError } from "@/lib/ai";
import { generateMarketingContent } from "@/lib/ai/marketing";
import { getCurrentUser } from "@/lib/supabase/server";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";

const bodySchema = z.object({
  type: z.string().trim().min(1).max(40).default("product"),
  title: z.string().trim().min(1).max(200),
  price: z.string().trim().max(100).optional(),
  features: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  extraDetails: z.string().trim().max(2000).optional(),
  photoUrls: z.array(z.url()).max(20).default([]),
});

// Creates a project and generates its caption, video script and ad headlines.
// Costs 1 text generation from the user's plan.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) return NextResponse.json({ error: "Business profile not found" }, { status: 409 });

  let reservation;
  try {
    reservation = await consumeUsage(user.id, "text");
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return NextResponse.json({ error: "usage_blocked", reason: error.reason }, { status: 402 });
    }
    throw error;
  }

  try {
    const result = await generateMarketingContent(
      getTextProvider(),
      {
        businessName: business.name,
        industry: business.industry,
        description: business.description,
        tone: business.tone,
      },
      input,
    );

    const project = await prisma.project.create({
      data: {
        businessId: business.id,
        type: input.type,
        title: input.title,
        price: input.price,
        features: input.features,
        photoUrls: input.photoUrls,
        details: input.extraDetails ? { notes: input.extraDetails } : undefined,
        contents: {
          create: { ...result.content, provider: result.provider, model: result.model },
        },
      },
      include: { contents: true },
    });

    return NextResponse.json({ projectId: project.id, content: project.contents[0] });
  } catch (error) {
    await refundUsage(user.id, "text", reservation.periodStart);
    if (error instanceof AIProviderError) {
      return NextResponse.json(
        { error: "ai_failed", message: error.message, retryable: error.retryable },
        { status: 502 },
      );
    }
    console.error("Generation failed", error);
    return NextResponse.json(
      { error: "server_error", message: "Content generation is not available right now." },
      { status: 500 },
    );
  }
}
