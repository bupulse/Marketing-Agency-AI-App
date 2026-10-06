"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "./theme-provider";

/** 44px glass icon button. Icons swap via CSS (`dark:`), so there is no hydration flash. */
export function ThemeToggle({ className }: { className?: string }) {
  const { toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark theme"
      title="Toggle theme"
      className={cn(
        "glass inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-text transition-transform duration-300 hover:-translate-y-0.5 hover:rounded-2xl",
        className,
      )}
    >
      <Moon aria-hidden className="size-5 dark:hidden" />
      <Sun aria-hidden className="hidden size-5 dark:block" />
    </button>
  );
}
