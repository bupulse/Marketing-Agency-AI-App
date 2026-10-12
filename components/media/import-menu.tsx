"use client";

/**
 * The "Import" menu: From Google Drive, From Dropbox, From Canva. It owns the pickers; the host passes the
 * `importer` (useImporter) and shows its progress with <UploadProgress verb="Importing">.
 *
 * Props:
 *   importer         From useImporter(onImported).
 *   destinations        Folders and albums, for the "Save to" choice (lib/media/destinations.ts destinationOptions).
 *   defaultDestination  Where files go unless the person picks another place; null: they must pick one first.
 *   onPickerVisible  Called with true while Google's Picker is open. It cannot sit above a modal <dialog>,
 *                    so a host that is inside one hides it until this is called with false.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Box, ChevronDown, Download, HardDrive, Palette } from "lucide-react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getImportOptions, importFromDrive, importFromDropbox } from "@/app/dashboard/gallery/import-actions";
import type { ImportOptions } from "@/lib/media/importers";
import { IMPORT_MAX_FILES } from "@/lib/media/rules";
import type { DestinationOption } from "@/lib/media/destinations";
import { CanvaImportDialog } from "./canva-import-dialog";
import { dropboxReady, googleReady, pickFromDrive, pickFromDropbox, preloadDropbox, preloadGoogle } from "./import-sdk";
import type { useImporter } from "./use-importer";

type Props = {
  importer: ReturnType<typeof useImporter>;
  destinations: DestinationOption[];
  defaultDestination: string | null;
  onPickerVisible?: (visible: boolean) => void;
  className?: string;
};

export function ImportMenu({ importer, destinations, defaultDestination, onPickerVisible, className }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ImportOptions | null>(null);
  const [override, setOverride] = useState<string | undefined>(undefined);
  const [canva, setCanva] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const menuId = useId();

  const destination = override !== undefined && destinations.some((d) => d.key === override) ? override : defaultDestination;
  const busy = importer.state.active;

  const toggle = useCallback(() => {
    setOpen((o) => !o);
  }, []);

  // The menu opens under the button, right-aligned; on a phone the button can sit near the left edge, so nudge it back on screen.
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const rect = menu.current.getBoundingClientRect();
    const margin = 16;
    const current = shift;
    const left = rect.left - current;
    const right = rect.right - current;
    setShift(left < margin ? margin - left : right > window.innerWidth - margin ? window.innerWidth - margin - right : 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- measured once per opening

  // Load the keys and the provider scripts as soon as the menu opens, so each picker can start from the click itself.
  useEffect(() => {
    if (!open || options) return;
    let live = true;
    void getImportOptions().then((res) => {
      if (live && res.ok) setOptions(res.options);
    });
    return () => {
      live = false;
    };
  }, [open, options]);

  useEffect(() => {
    if (!options) return;
    if (options.google) void preloadGoogle().catch(() => {});
    if (options.dropboxAppKey) void preloadDropbox(options.dropboxAppKey).catch(() => {});
  }, [options]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function drive() {
    const google = options?.google;
    if (!google) return;
    if (!googleReady()) return toast("Google is still loading. Try again in a moment.", "error");
    setOpen(false);
    pickFromDrive(google, IMPORT_MAX_FILES, (visible) => onPickerVisible?.(visible)).then(
      (picked) => {
        if (!picked || picked.files.length === 0) return;
        void importer.run(picked.files.map((f) => ({ name: f.name, run: () => importFromDrive({ token: picked.token, fileId: f.id, destination: destination! }) })));
      },
      () => {
        onPickerVisible?.(false);
        toast("Google Drive could not be opened. Check that pop-ups are allowed and try again.", "error");
      },
    );
  }

  function dropbox() {
    if (!options?.dropboxAppKey) return;
    if (!dropboxReady()) return toast("Dropbox is still loading. Try again in a moment.", "error");
    setOpen(false);
    pickFromDropbox().then(
      (files) => {
        if (files.length === 0) return;
        void importer.run(files.slice(0, IMPORT_MAX_FILES).map((f) => ({ name: f.name, run: () => importFromDropbox({ link: f.link, name: f.name, destination: destination! }) })));
      },
      () => toast("Dropbox could not be opened. Check that pop-ups are allowed and try again.", "error"),
    );
  }

  const entries = [
    { key: "drive", label: "From Google Drive", icon: HardDrive, ready: options ? !!options.google : null, run: drive },
    { key: "dropbox", label: "From Dropbox", icon: Box, ready: options ? !!options.dropboxAppKey : null, run: dropbox },
    {
      key: "canva",
      label: "From Canva",
      icon: Palette,
      ready: options ? options.canva !== "unavailable" : null,
      run: () => {
        setOpen(false);
        setCanva(true);
      },
    },
  ];

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={toggle}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold hover:bg-soft disabled:pointer-events-none disabled:opacity-50"
      >
        <Download aria-hidden className="size-4" />
        Import
        <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-300 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div ref={menu} style={shift ? { right: -shift } : undefined} id={menuId} role="menu" aria-label="Import photos" className="animate-pop absolute right-0 z-30 border border-line bg-surface mt-2 w-[min(18rem,calc(100vw-3rem))] rounded-2xl p-2 shadow-glass">
          <label className="flex flex-col gap-1 px-3 pt-2 pb-3 text-xs font-semibold text-muted">
            Save to
            <select
              value={destination ?? ""}
              onChange={(e) => setOverride(e.target.value || undefined)}
              className="min-h-11 w-full cursor-pointer rounded-xl border border-line bg-transparent px-3 text-[15px] font-medium text-text"
            >
              {!destination && <option value="">Choose a folder or product…</option>}
              {(["Folders", "Products", "Campaigns"] as const).map((group) => {
                const items = destinations.filter((d) => d.group === group);
                return items.length ? (
                  <optgroup key={group} label={group}>
                    {items.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
            {!destination && <span className="font-normal">{destinations.length ? "Pick where the photos go first." : "Create a folder or add a product first."}</span>}
          </label>
          {entries.map(({ key, label, icon: Icon, ready, run }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              disabled={ready !== true || !destination}
              onClick={run}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium hover:bg-soft disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <Icon aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="flex-1">{label}</span>
              {ready === false && <span className="text-xs text-muted">Coming soon</span>}
            </button>
          ))}
        </div>
      )}
      <CanvaImportDialog open={canva && !!destination} onOpenChange={setCanva} destination={destination ?? ""} onImport={(tasks) => void importer.run(tasks)} />
    </div>
  );
}
