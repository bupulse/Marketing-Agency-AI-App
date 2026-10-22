import { featureGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { QuizLink } from "@/components/knowledge/quiz-link";
import { PersonaEditor } from "@/components/knowledge/persona-editor";
import { personaFormValues, personaLine } from "@/lib/knowledge/audience";
import { listPersonas } from "@/lib/knowledge/records";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Customers & audience" };

export default async function AudiencePage() {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  const personas = await listPersonas(business.id);
  return (
    <>
      <BackLink />
      <PageHeader title="Customers & audience" description="Who buys from you, what they need and how they decide. BuPulse writes every post for these people." action={can(role, "content") ? <QuizLink round="customers" /> : undefined} />
      <PersonaEditor personas={personas.map((p) => ({ id: p.id, line: personaLine(p), values: personaFormValues(p) }))} notes={business.audienceNotes ?? ""} canEdit={can(role, "content")} />
    </>
  );
}
