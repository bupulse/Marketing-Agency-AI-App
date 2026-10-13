"use client";

import { ChevronDown, CreditCard, LayoutDashboard, LogOut, Newspaper, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { buttonClasses } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export const accountLinks = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Content", href: "/dashboard/content", icon: Newspaper },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

/**
 * The signed-in visitor's email, or null. Read from the session cookie in the browser (no network call), so the
 * marketing pages stay static: they render "Log in" and switch to the account menu once this resolves.
 */
export function useSignedInEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    let live = true;
    supabase.auth.getSession().then(({ data }) => live && setEmail(data.session?.user.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setEmail(session?.user.email ?? null));
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return email;
}

/** Header control: "Log in" for visitors; "Account" with a menu (opens on hover, focus or click) when signed in. */
export function AccountMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!email) {
    return (
      <Link href="/login" className={`${buttonClasses({ variant: "ghost", size: "sm" })} hidden whitespace-nowrap lg:inline-flex`}>
        Log in
      </Link>
    );
  }
  return (
    <div
      className="relative hidden lg:block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={`${buttonClasses({ variant: "ghost", size: "sm" })} cursor-pointer gap-1.5 whitespace-nowrap`}
      >
        <UserRound aria-hidden className="size-4" /> Account
        <ChevronDown aria-hidden className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {/* pt-2 keeps the hover area continuous between the button and the panel */}
      <div id={menuId} role="menu" hidden={!open} className="absolute right-0 top-full z-40 w-60 pt-2">
        <div className="glass-strong animate-pop flex flex-col gap-0.5 rounded-2xl p-2">
          <p className="truncate px-3 pt-1 pb-2 text-xs text-muted">{email}</p>
          {accountLinks.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-text no-underline hover:bg-soft"
            >
              <Icon aria-hidden className="size-4" /> {label}
            </Link>
          ))}
          <form action="/auth/signout" method="post" className="border-t border-line pt-1">
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-text hover:bg-soft"
            >
              <LogOut aria-hidden className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
