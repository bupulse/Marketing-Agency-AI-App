import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { ProductForm } from "@/components/knowledge/product-form";
import { productFormValues } from "@/lib/knowledge/products";
import { defaultCurrency } from "@/lib/knowledge/service";

export const metadata = { title: "Add a product or service" };

export default async function NewProductPage() {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  return (
    <>
      <BackLink href="/dashboard/knowledge/products" label="Products & services" />
      <PageHeader title="Add a product or service" description="Tell BuPulse what you sell. You can change anything later." />
      <ProductForm initial={productFormValues(null, await defaultCurrency(business.id))} />
    </>
  );
}
