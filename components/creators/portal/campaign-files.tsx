import { Check, Download, ExternalLink, FileText, FolderOpen, Printer, X } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import type { CampaignFolders, SignedAsset } from "@/lib/creators/campaign-files";

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);

/** One file: a preview for photos and videos, its name and size, and Download. */
function FileCard({ file }: { file: SignedAsset }) {
  const picture = file.kind === "video" ? file.posterUrl : file.mimeType.startsWith("image/") ? file.url : null;
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-line bg-glass">
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
        <img src={picture} alt="" loading="lazy" className="aspect-square w-full bg-soft object-cover" />
      ) : (
        <span aria-hidden className="flex aspect-square w-full items-center justify-center bg-soft">
          <FileText className="size-8 text-muted" />
        </span>
      )}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p className="line-clamp-2 break-all text-[13px] font-medium">{file.name}</p>
        <p className="text-[12px] text-muted">
          {file.kind === "video" ? "Video" : file.mimeType.startsWith("image/") ? "Photo" : "File"} · {size(file.bytes)}
        </p>
        <a href={file.downloadUrl} className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold text-pulse-blue no-underline" aria-label={`Download ${file.name}`}>
          <Download aria-hidden className="size-4" /> Download
        </a>
      </div>
    </li>
  );
}

function Folder({ title, files, empty }: { title: string; files: SignedAsset[]; empty: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[15px] font-semibold">
        {title} <span className="font-normal text-muted">({files.length})</span>
      </h3>
      {files.length ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map((f) => (
            <FileCard key={f.id} file={f} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}

/** Do's and don'ts as two short lists (the public page and the brief show the same). */
export function DosDonts({ dos, donts }: { dos: string[]; donts: string[] }) {
  if (!dos.length && !donts.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {dos.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-semibold">Do</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {dos.map((d) => (
              <li key={d} className="flex gap-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {donts.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-semibold">Don&apos;t</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {donts.map((d) => (
              <li key={d} className="flex gap-2">
                <X aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "Campaign files" on a joined campaign (docs/CREATOR_CAMPAIGN_WIZARD.md, "Files"): the do's and don'ts, the company's
 * Images, Videos and Documents folders to download, its shared Drive folder and the posts it likes, and the brief to
 * print or save as a PDF.
 */
export function CampaignFiles({ campaignId, dos, donts, folders }: { campaignId: string; dos: string[]; donts: string[]; folders: CampaignFolders }) {
  const none = !folders.images.length && !folders.videos.length && !folders.documents.length;
  return (
    <section aria-labelledby="files" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="files" className="text-lg font-semibold tracking-tight">Campaign files</h2>
        <Button href={`/creator/campaigns/${campaignId}/brief`} size="sm" variant="outline" leading={<Printer aria-hidden className="size-4" />}>
          Brief to print or save
        </Button>
      </div>
      <GlassCard padding="none" className="flex flex-col gap-5 p-4">
        <DosDonts dos={dos} donts={donts} />
        {none ? (
          <p className="text-sm text-muted">The company has not added files yet.</p>
        ) : (
          <>
            <Folder title="Images" files={folders.images} empty="No photos yet." />
            <Folder title="Videos" files={folders.videos} empty="No videos yet." />
            {folders.documents.length > 0 && <Folder title="Documents" files={folders.documents} empty="" />}
          </>
        )}
        {folders.driveUrl && (
          <a href={folders.driveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-semibold text-pulse-blue no-underline">
            <FolderOpen aria-hidden className="size-4" /> Open the shared Google Drive folder <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
        {folders.exampleLinks.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-semibold">Posts they like</h3>
            {folders.exampleLinks.map((l) => (
              <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 self-start break-all text-sm text-pulse-blue">
                {host(l)} <ExternalLink aria-hidden className="size-3.5 shrink-0" />
              </a>
            ))}
          </div>
        )}
      </GlassCard>
    </section>
  );
}
