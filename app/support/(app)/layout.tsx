import { SupportAppProvider } from "@/components/support-app/app-context";
import { SupportShell } from "@/components/support-app/shell";
import { pushPublicKey } from "@/lib/push/service";
import { requireSupportAgentPage } from "@/lib/support/app-auth";

// Every support app page: an agent who is not locked, at AAL2 (lib/support/app-auth.ts). Each page checks again.
export default async function SupportAppLayout({ children }: LayoutProps<"/support">) {
  const me = await requireSupportAgentPage();
  return (
    <SupportAppProvider me={me} pushKey={pushPublicKey()}>
      <SupportShell>{children}</SupportShell>
    </SupportAppProvider>
  );
}
