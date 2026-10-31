"use client";

import { Button } from "@/components/ui";
import { AccountMenu, useSignedInEmail } from "./account-menu";
import { MobileMenu } from "./mobile-menu";
import { CtaButton } from "./quote/cta";

/**
 * The right side of the marketing header after the theme toggle: Log in and "Start your free trial" for visitors (in
 * Rwanda "Get a free quote", which opens the quote pop-up; lib/quote/cta.ts); for a signed-in client, the Account menu
 * and "Go to dashboard" (they already have an account).
 */
export function HeaderActions({ links }: { links: { label: string; href: string }[] }) {
  const email = useSignedInEmail();
  return (
    <>
      <AccountMenu email={email} />
      {email ? (
        <Button href="/dashboard" size="sm" className="hidden whitespace-nowrap sm:inline-flex">
          Go to dashboard
        </Button>
      ) : (
        <CtaButton
          size="sm"
          className="hidden whitespace-nowrap sm:inline-flex"
          trialLabel={
            <>
              <span className="lg:hidden">Try it free</span>
              <span className="hidden lg:inline">Start your free trial</span>
            </>
          }
          quoteLabel={
            <>
              <span className="lg:hidden">Free quote</span>
              <span className="hidden lg:inline">Get a free quote</span>
            </>
          }
        />
      )}
      <MobileMenu links={links} email={email} />
    </>
  );
}
