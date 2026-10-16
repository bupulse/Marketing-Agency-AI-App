import { redirect } from "next/navigation";

// The address push and WhatsApp alerts open (/dashboard/leads/<id>): the inbox with that lead open.
export default async function LeadLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/leads?lead=${encodeURIComponent(id)}`);
}
