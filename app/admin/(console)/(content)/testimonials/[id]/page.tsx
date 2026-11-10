import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/auth";
import { Quote } from "lucide-react";
import { PageHeader, StatusPill } from "@/components/admin/kit";
import { TESTIMONIAL_PILL } from "@/components/admin/content-ai/testimonials-view";
import { Panel } from "@/components/admin/ui";
import { TestimonialForm } from "@/components/admin/testimonial-form";
import { AdminError } from "@/lib/admin/types";
import { getTestimonialAdmin } from "@/lib/testimonials/service";
import { testimonialState } from "@/lib/testimonials/shared";

export const metadata = { title: "Testimonial" };
export const dynamic = "force-dynamic";

export default async function EditTestimonialPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content");
  const { id } = await params;
  let t;
  try {
    t = await getTestimonialAdmin(id);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  const badge = TESTIMONIAL_PILL[testimonialState(t)];
  return (
    <>
      <PageHeader
        title={`${t.clientName}, ${t.business}`}
        icon={Quote}
        tone="pink"
        description="Shown on the home page and the pricing page only when published. Only publish words the client agreed to."
        back={{ href: "/admin/testimonials", label: "Testimonials" }}
        actions={<StatusPill tone={badge.tone} dot>{badge.text}</StatusPill>}
      />
      <Panel title="Edit testimonial">
        <TestimonialForm initial={{ id: t.id, clientName: t.clientName, business: t.business, sector: t.sector, quote: t.quote, result: t.result, consent: t.consent, published: t.published, photoUrl: t.photoUrl }} />
      </Panel>
    </>
  );
}
