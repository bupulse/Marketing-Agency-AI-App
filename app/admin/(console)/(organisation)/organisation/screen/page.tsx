import { ScreenView } from "@/components/admin/organisation/screen-view";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { listScreenLinks } from "@/lib/screen/links";
import { MAX_ACTIVE_SOUNDS, SOUND_MAX_SECONDS } from "@/lib/screen/shared";
import { cleanupSoundOrphans, listSounds, soundPlayUrl } from "@/lib/screen/sounds";

export const metadata = { title: "Sales screen" };
export const dynamic = "force-dynamic";

export default async function SalesScreenPage({ searchParams }: PageProps<"/admin/organisation/screen">) {
  await requirePermission("screen.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  await cleanupSoundOrphans();
  const [links, sounds] = await Promise.all([listScreenLinks(), listSounds()]);
  const urls = await Promise.all(sounds.map((s) => soundPlayUrl(s.path)));
  return (
    <ScreenView
      links={links}
      sounds={sounds.map((s, i) => ({ id: s.id, name: s.name, source: s.source, bytes: s.bytes, active: s.active, url: (urls[i] as string | null) ?? null }))}
      maxActive={MAX_ACTIVE_SOUNDS}
      maxSeconds={SOUND_MAX_SECONDS}
      ok={param(sp.notice)}
      bad={param(sp.error)}
    />
  );
}
