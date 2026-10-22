import { featureGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { QuizLink } from "@/components/knowledge/quiz-link";
import { ReviewEditor } from "@/components/knowledge/review-editor";
import { localParts, safeZone } from "@/lib/autopilot/timezone";
import { prisma } from "@/lib/db";
import { listReviews } from "@/lib/knowledge/records";
import { reviewFormValues } from "@/lib/knowledge/reviews";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Reviews & testimonials" };

export default async function ReviewsPage() {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  const [reviews, products] = await Promise.all([
    listReviews(business.id),
    prisma.product.findMany({ where: { businessId: business.id, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
  ]);
  const p = localParts(new Date(), safeZone(business.timezone));
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return (
    <>
      <BackLink />
      <PageHeader title="Reviews & testimonials" description="What customers say about you. BuPulse quotes only the reviews customers agreed to share, word for word." action={can(role, "content") ? <QuizLink round="love" /> : undefined} />
      <ReviewEditor reviews={reviews.map((r) => ({ id: r.id, values: reviewFormValues(r), productName: r.product?.name ?? null }))} products={products} today={today} canEdit={can(role, "content")} canGrant={can(role, "settings")} />
    </>
  );
}
