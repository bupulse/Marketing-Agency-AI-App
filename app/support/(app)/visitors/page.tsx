import { VisitorsView } from "@/components/support-app/visitors-view";
import { requireSupportAgentPage } from "@/lib/support/app-auth";

export const metadata = { title: "Live visitors" };

export default async function SupportVisitorsPage() {
  await requireSupportAgentPage();
  return <VisitorsView />;
}
