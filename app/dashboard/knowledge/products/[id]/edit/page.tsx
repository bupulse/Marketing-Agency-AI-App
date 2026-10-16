import { notFound } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { ProductForm } from "@/components/knowledge/product-form";
import { productFormValues } from "@/lib/knowledge/products";
import { getProduct } from "@/lib/knowledge/service";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { id } = await params;
  const { business } = await getAppContext();
  const product = await getProduct(business.id, id);
  if (!product) notFound();
  return (
    <>
      <BackLink href={`/dashboard/knowledge/products/${product.id}`} label={product.name} />
      <PageHeader title="Edit product" description="Changes apply to new posts and designs; what you already made stays as it is." />
      <ProductForm productId={product.id} initial={productFormValues(product, product.currency)} />
    </>
  );
}
