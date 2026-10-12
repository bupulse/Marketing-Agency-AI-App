import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { FaqEditor, PoliciesForm } from "@/components/knowledge/faq-editor";
import { readPolicies } from "@/lib/knowledge/policies";
import { listFaqs } from "@/lib/knowledge/records";
import { can } from "@/lib/team/roles";

export const metadata = { title: "FAQs & policies" };

export default async function FaqsPage() {
  const { business, role } = await getAppContext();
  const faqs = await listFaqs(business.id);
  return (
    <>
      <BackLink />
      <PageHeader title="FAQs & policies" description="Answers to what customers ask, and your rules for delivery, returns, payment and bookings. Your website chat and your posts use them." />
      <FaqEditor faqs={faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer }))} canEdit={can(role, "content")} />
      <PoliciesForm initial={readPolicies(business.policies)} canEdit={can(role, "settings")} />
    </>
  );
}
