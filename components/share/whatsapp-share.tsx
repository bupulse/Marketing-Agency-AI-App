"use client";

import { useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { recordWhatsAppShare } from "@/app/dashboard/share-actions";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { installPlatform } from "@/lib/phone-app";
import { MAX_SHARED_FILES, shareFileName, shareFileType, whatsappTextLink } from "@/lib/share/whatsapp";

/**
 * "Share to WhatsApp" (docs/guide/features/32-phone-app-and-whatsapp-share.md) on a post or a video. On a phone it
 * opens the phone's share menu with the picture or video itself and the caption, so the owner picks WhatsApp and puts
 * it on their Status or sends it to a customer or group. Where files cannot be shared (computers, old browsers) it
 * downloads them and opens WhatsApp with the caption filled in. The caption is also copied, in case WhatsApp leaves it
 * out. The files come from the signed links the page already has: nothing is made public.
 *
 * Props:
 *   media    the post's pictures or the video ({ path, url }: stored path and signed link); none shares the words only
 *   caption  the words to share (lib/share/whatsapp.ts whatsappCaption for a post)
 *   what     "post" or "video": the file names and the share count
 */

type Media = { path: string; url: string };
type Phase = "idle" | "loading" | "ready";

/**
 * Whether this is a phone or tablet whose browser can hand files to another app (Android Chrome, iPhone Safari),
 * checked with an empty picture. Computers that can share too (a Mac) still get the download, where WhatsApp is.
 */
function phoneCanShareFiles(): boolean {
  try {
    if (!installPlatform(navigator.userAgent, navigator.maxTouchPoints)) return false;
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
}

/** Saves a downloaded file under its name (an object URL, as a signed link from storage ignores the name). */
function saveFile(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = href;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export function WhatsAppShare({ media, caption, what, className }: { media: readonly Media[]; caption: string; what: "post" | "video"; className?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<{ text: string; link?: string; tone: "info" | "error" } | null>(null);
  const files = useRef<File[] | null>(null);
  const shown = media.slice(0, MAX_SHARED_FILES);

  async function loadFiles(): Promise<File[]> {
    if (files.current) return files.current;
    const list = await Promise.all(
      shown.map(async (m, i) => {
        const res = await fetch(m.url);
        if (!res.ok) throw new Error(`media ${res.status}`);
        const blob = await res.blob();
        return new File([blob], shareFileName(m.path, i, shown.length, what), { type: shareFileType(m.path, blob.type) });
      }),
    );
    files.current = list;
    return list;
  }

  const count = (how: "share" | "download") => {
    recordWhatsAppShare(what, how).catch(() => undefined);
  };

  /** Hands the files and caption to the phone's share menu. False when the browser cannot take these files. */
  async function shareFiles(): Promise<boolean> {
    const list = await loadFiles();
    if (!navigator.canShare({ files: list })) return false;
    await navigator.share({ files: list, text: caption });
    count("share");
    setPhase("idle");
    setNote({ text: "Shared. The caption is copied too: paste it if WhatsApp left it out.", tone: "info" });
    return true;
  }

  /** Computers and old browsers: download the files, then open WhatsApp with the caption. */
  async function downloadAndOpen() {
    const list = shown.length ? await loadFiles() : [];
    list.forEach(saveFile);
    const link = whatsappTextLink(caption);
    window.open(link, "_blank", "noopener,noreferrer");
    count("download");
    setPhase("idle");
    setNote({ text: list.length ? `Download done. Add the ${what === "video" ? "video" : list.length > 1 ? "pictures" : "picture"} in WhatsApp.` : "WhatsApp opens with the caption.", link, tone: "info" });
  }

  async function onClick() {
    setNote(null);
    // Copied first, while the tap still counts: iPhone WhatsApp often drops the text when it gets a picture.
    navigator.clipboard?.writeText(caption).catch(() => undefined);
    setPhase("loading");
    try {
      const phone = phoneCanShareFiles();
      if (phone && shown.length === 0) {
        await navigator.share({ text: caption });
        count("share");
        setPhase("idle");
        return;
      }
      if (phone && (await shareFiles())) return;
      await downloadAndOpen();
    } catch (error) {
      const name = errorName(error);
      // The person closed the share menu.
      if (name === "AbortError") return setPhase(files.current ? "ready" : "idle");
      // A big file took longer than the tap allows: the files are ready now, a second tap shares them at once.
      if (name === "NotAllowedError" && files.current) {
        setPhase("ready");
        setNote({ text: `Your ${what === "video" ? "video" : "post"} is ready. Tap “Share now” to choose WhatsApp.`, tone: "info" });
        return;
      }
      setPhase("idle");
      files.current = null;
      setNote({ text: `We could not get the ${what === "video" ? "video" : "picture"}. Reload the page and try again.`, tone: "error" });
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Button
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={phase === "loading"}
        aria-label={phase === "ready" ? "Share now to WhatsApp" : `Share this ${what} to WhatsApp`}
        leading={phase === "loading" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <MessageCircle aria-hidden className="size-4 text-[#0a7d4f] dark:text-[#25D366]" />}
      >
        {phase === "loading" ? "Getting it ready..." : phase === "ready" ? "Share now" : "Share to WhatsApp"}
      </Button>
      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={cn("text-[13px]", note.tone === "error" ? "text-danger" : "text-muted")}>
          {note.text}{" "}
          {note.link && (
            <a href={note.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline underline-offset-2">
              Open WhatsApp
            </a>
          )}
        </p>
      )}
    </div>
  );
}
