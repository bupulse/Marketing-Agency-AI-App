"use client";

import { Button } from "@/components/ui";
import { AccountMenu, useSignedInEmail } from "./account-menu";
import { MobileMenu } from "./mobile-menu";

/**
 * The right side of the marketing header after the theme toggle: Log in and "Book a demo" for visitors; for a signed-in
 * client, the Account menu and "Go to dashboard" (they already have an account).
 */
export function HeaderActions({ links }: { links: { label: string; href: string }[] }) {
  const email = useSignedInEmail();
  return (
    <>
      <AccountMenu email={email} />
      <Button href={email ? "/dashboard" : "/signup"} size="sm" className="hidden whitespace-nowrap sm:inline-flex">
        {email ? (
          "Go to dashboard"
        ) : (
          <>
            <span className="lg:hidden">Book a demo</span>
            <span className="hidden lg:inline">Book a free demo</span>
          </>
        )}
      </Button>
      <MobileMenu links={links} email={email} />
    </>
  );
}
