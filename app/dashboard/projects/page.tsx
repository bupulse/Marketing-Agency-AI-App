import { redirect } from "next/navigation";

// Projects became Products & services and Campaigns in the Knowledge base (docs/KNOWLEDGE_BASE.md).
export default function ProjectsPage() {
  redirect("/dashboard/knowledge/products");
}
