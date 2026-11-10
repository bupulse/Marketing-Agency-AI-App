import { requirePermission } from "@/lib/admin/auth";
import { listServicesWithKeys } from "@/lib/admin/services";
import { CustomKeysPage } from "@/components/admin/system/services/more-services";

export const metadata = { title: "Custom keys" };

/** Admin -> Services -> Custom keys: keys for any other service, saved encrypted. */
export default async function CustomKeysRoute() {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const { custom } = await listServicesWithKeys();
  return <CustomKeysPage custom={custom} />;
}
