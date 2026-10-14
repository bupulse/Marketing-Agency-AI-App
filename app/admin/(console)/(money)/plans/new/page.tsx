import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { PlanForm } from "@/components/admin/plan-form";
import { paddleConnected } from "@/lib/billing/paddle-catalog";

export const metadata = { title: "New plan" };

export default async function NewPlanPage() {
  await requirePermission("plans.manage");
  return (
    <>
      <PageHeader title="New plan" description="Saved as a draft unless you make it active. Creating it also creates the product and prices in Paddle." />
      <PlanForm
        mode="create"
        paddleConnected={await paddleConnected()}
        subscribers={0}
        initial={{
          key: "",
          name: "",
          description: "",
          isTrial: false,
          trialDays: null,
          status: "hidden",
          sortOrder: 30,
          highlight: false,
          monthlyPriceCents: 0,
          yearlyPriceCents: 0,
          limits: { text: 0, image: 0, videos: 0, voiceCharacters: 0, chat: 0, seats: 1 },
          highlights: [],
          features: [],
        }}
      />
    </>
  );
}
