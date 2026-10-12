import { redirect } from "next/navigation";

// Projects became Products & services and Campaigns in the Knowledge base (docs/KNOWLEDGE_BASE.md).
export default function NewProjectPage() {
  redirect("/dashboard/knowledge/products/new");
}
