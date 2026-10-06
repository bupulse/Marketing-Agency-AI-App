import { cn } from "@/lib/cn";

type BackgroundBlobsProps = {
  /** "page" fixes behind the whole page; "section" fills the nearest positioned parent. */
  mode?: "page" | "section";
  className?: string;
};

/** Morphing blurred brand blobs. Decorative, CSS-only, paused for reduced motion. */
export function BackgroundBlobs({ mode = "page", className }: BackgroundBlobsProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none inset-0 -z-10 overflow-hidden",
        mode === "page" ? "fixed" : "absolute",
        className,
      )}
    >
      <div className="bp-blob bp-blob-a -top-24 -left-24 size-[420px] sm:size-[520px]" />
      <div className="bp-blob bp-blob-b -right-24 top-1/3 size-[380px] sm:size-[480px]" />
      <div
        className="bp-blob bp-blob-a bottom-[-120px] left-1/3 size-[300px] opacity-70 sm:size-[380px]"
        style={{ animationDuration: "20s" }}
      />
    </div>
  );
}
