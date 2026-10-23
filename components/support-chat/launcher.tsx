import { COPY } from "@/lib/support/client/copy";
import { cn } from "@/lib/cn";
import { ChatIcon, ChevronDownIcon } from "./icons";

/** Bottom-right corner, above the dashboard's and the creator portal's phone bars (--bp-bottom-bar). */
export const CORNER = "fixed right-4 bottom-[calc(var(--bp-bottom-bar,0px)+1rem)] sm:right-6 sm:bottom-[calc(var(--bp-bottom-bar,0px)+1.5rem)]";

/** The round gradient chat button. A red dot means a greeting or a new message is waiting. */
export function Launcher({
  open = false,
  dot = false,
  hidden = false,
  onClick,
  onIntent,
  buttonRef,
}: {
  open?: boolean;
  dot?: boolean;
  /** Hidden while the full-screen panel covers a phone. */
  hidden?: boolean;
  onClick: () => void;
  /** Pointer over or focus: a good moment to start loading the chat. */
  onIntent?: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      aria-label={open ? COPY.launcherClose : dot ? COPY.launcherNew : COPY.launcherOpen}
      aria-expanded={open}
      className={cn(
        CORNER,
        "z-50 inline-flex size-[60px] cursor-pointer items-center justify-center rounded-full border-0 bg-brand-gradient text-white shadow-glow transition-transform duration-200 hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 print:hidden",
        hidden && "max-[480px]:hidden",
      )}
    >
      {open ? <ChevronDownIcon /> : <ChatIcon />}
      {dot && !open && <span className="absolute top-0.5 right-0.5 size-3.5 rounded-full border-2 border-[var(--bp-bg)] bg-danger" />}
    </button>
  );
}
