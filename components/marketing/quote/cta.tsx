"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Button, Dialog, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { QUOTE_LABEL, type CtaMode } from "@/lib/quote/cta";
import { cleanPagePath, cleanQuoteSource } from "@/lib/quote/source";
import { QuoteForm } from "./quote-form";

// The marketing site's main call to action (lib/quote/cta.ts): "Start your free trial" for most visitors, "Get a free
// quote" for Rwanda visitors, which opens the quote form in a pop-up. The marketing layout decides the mode once per
// request from the visitor's region and provides it here, so every button on the page agrees and nothing flickers.

type CtaValue = { mode: CtaMode; openQuote: () => void };

const CtaContext = createContext<CtaValue>({ mode: "trial", openQuote: () => {} });

/** The mode for this visitor; "trial" outside the marketing layout. */
export function useCtaMode(): CtaMode {
  return useContext(CtaContext).mode;
}

/** The mode and the function that opens the quote pop-up, for a control that is not a CtaButton (the phone menu). */
export function useQuoteCta(): CtaValue {
  return useContext(CtaContext);
}

/** Provides the mode and, for Rwanda visitors, the pop-up quote form. */
export function CtaProvider({ mode, children }: { mode: CtaMode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState({ source: "website", pageUrl: "/" });
  // A new form after a request was sent and the thank-you closed, so a second quote starts empty.
  const [round, setRound] = useState(0);

  const openQuote = useCallback(() => {
    // Where the pop-up was opened: the page, and the link's ?src= (or utm_source) when the visitor came from one.
    const params = new URLSearchParams(window.location.search);
    setFrom({
      source: cleanQuoteSource(params.get("src") ?? params.get("utm_source")),
      pageUrl: cleanPagePath(`${window.location.pathname}${window.location.search}`) ?? "/",
    });
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ mode, openQuote }), [mode, openQuote]);

  return (
    <CtaContext.Provider value={value}>
      {children}
      {mode === "quote" && (
        <Dialog open={open} onOpenChange={setOpen} title={QUOTE_LABEL} description="Tell us about your business. We call you back shortly with a price that fits.">
          <QuoteForm
            key={round}
            source={from.source}
            pageUrl={from.pageUrl}
            onClose={() => {
              setOpen(false);
              setRound((r) => r + 1);
            }}
          />
        </Dialog>
      )}
    </CtaContext.Provider>
  );
}

type CtaButtonProps = {
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** The trial button's link and label (default: /signup, "Start your free trial"). */
  trialHref?: string;
  trialLabel?: ReactNode;
  onTrialClick?: () => void;
  /** The quote button's label (default "Get a free quote"). */
  quoteLabel?: ReactNode;
};

/**
 * The main button: a link to the free trial, or for Rwanda visitors a button that opens the quote pop-up. Same size,
 * colours and icon either way, so the page looks the same.
 */
export function CtaButton({ trialHref = "/signup", trialLabel = "Start your free trial", onTrialClick, quoteLabel = QUOTE_LABEL, ...look }: CtaButtonProps) {
  const { mode, openQuote } = useContext(CtaContext);
  if (mode === "quote") {
    return (
      <Button type="button" aria-haspopup="dialog" onClick={openQuote} {...look}>
        {quoteLabel}
      </Button>
    );
  }
  return (
    <Button href={trialHref} onClick={onTrialClick} {...look}>
      {trialLabel}
    </Button>
  );
}

/** Shows `quote` to Rwanda visitors and `trial` to everyone else: the lines that talk about the free trial. */
export function ForCta({ trial, quote }: { trial: ReactNode; quote: ReactNode }) {
  return <>{useCtaMode() === "quote" ? quote : trial}</>;
}
