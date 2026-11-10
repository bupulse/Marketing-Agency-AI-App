import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { EMPTY_TESTIMONIAL, TestimonialForm } from "@/components/admin/testimonial-form";

export const metadata = { title: "Add a testimonial" };
export const dynamic = "force-dynamic";

/** The "Add a testimonial" form, on its own page (it was at the top of the list). Saving goes back to the list. */
export default async function NewTestimonialPage() {
  await requirePermission("content");
  return (
    <>
      <PageHeader icon={Plus} tone="pink" title="Add a testimonial" description="Ask the client first, and keep their message saying yes. Without “The client agreed to be shown” it cannot be published." back={{ href: "/admin/testimonials", label: "Testimonials" }} />
      <Panel title="The testimonial">
        <TestimonialForm initial={EMPTY_TESTIMONIAL} />
      </Panel>
    </>
  );
}
