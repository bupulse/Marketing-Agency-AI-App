"use client";

import { useState, useTransition } from "react";
import { CalendarRange, Folder, FolderPlus, Package } from "lucide-react";
import { Button, Dialog, Input, useToast } from "@/components/ui";
import { createFolder } from "@/app/dashboard/gallery/actions";
import { destinationKey, type DestinationOption } from "@/lib/media/destinations";

const ICONS = { Folders: Folder, Products: Package, Campaigns: CalendarRange } as const;

/**
 * "Where should these photos go?": every upload names a folder, a product's album or a campaign's album first
 * (docs/KNOWLEDGE_BASE.md). Shown before the file picker when the screen has no destination of its own. A new folder
 * can be made here.
 */
export function DestinationDialog({
  open,
  onOpenChange,
  destinations,
  onPick,
  canCreateFolder = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: DestinationOption[];
  /** Called with "folder:<id>", "product:<id>" or "campaign:<id>". */
  onPick: (key: string, label: string) => void;
  canCreateFolder?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Where should these photos go?" description="Pick a folder, or the album of a product or campaign. A photo can be added to more albums later.">
      {open && <Body destinations={destinations} onPick={onPick} canCreateFolder={canCreateFolder} />}
    </Dialog>
  );
}

function Body({ destinations, onPick, canCreateFolder }: { destinations: DestinationOption[]; onPick: (key: string, label: string) => void; canCreateFolder: boolean }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const row = "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl px-4 text-left text-[15px] font-medium hover:bg-soft disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3">
      {destinations.length === 0 ? (
        <p className="text-[15px] text-muted">You have no folders or products yet. Start a folder below, or add a product in the Knowledge base.</p>
      ) : (
        <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
          {(["Folders", "Products", "Campaigns"] as const).map((group) => {
            const items = destinations.filter((d) => d.group === group);
            if (!items.length) return null;
            const Icon = ICONS[group];
            return (
              <section key={group} aria-label={group}>
                <h3 className="px-4 pb-1 text-[13px] font-semibold text-muted">{group}</h3>
                <ul>
                  {items.map((d) => (
                    <li key={d.key}>
                      <button type="button" className={row} disabled={pending} onClick={() => onPick(d.key, d.label)}>
                        <Icon aria-hidden className="size-4 shrink-0 text-muted" />
                        <span className="truncate">{d.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {canCreateFolder && (
        <form
          className="flex gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            start(async () => {
              const made = await createFolder(name);
              if (!made.ok) return toast(made.error, "error");
              onPick(destinationKey({ kind: "folder", id: made.folder.id }), made.folder.name);
            });
          }}
        >
          <Input aria-label="New folder name" value={name} maxLength={60} placeholder="Or start a new folder" onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="ghost" disabled={pending || !name.trim()} leading={<FolderPlus aria-hidden className="size-4" />}>
            Create
          </Button>
        </form>
      )}
    </div>
  );
}
