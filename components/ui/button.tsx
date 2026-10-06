import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "ghost" | "white" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-gradient text-white shadow-glow hover:shadow-glow-hover",
  ghost: "glass text-text",
  white: "bg-white text-ink shadow-glass border border-black/5",
  outline: "border border-line bg-transparent text-text hover:bg-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-[46px] px-[22px] text-[15px]",
  lg: "min-h-14 px-8 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-[28px] font-semibold no-underline",
    "transition-[transform,box-shadow,border-radius,background-color] duration-300 ease-out-soft",
    "hover:-translate-y-0.5 hover:rounded-2xl active:translate-y-0 [backface-visibility:hidden] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon or node shown before the label. */
  leading?: ReactNode;
  /** Icon or node shown after the label. */
  trailing?: ReactNode;
};

type ButtonAsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & { href?: undefined; className?: string };
type ButtonAsLink = Common &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href"> & { href: string; className?: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

/**
 * Button. Pass `href` to render a next/link (or a plain <a> for external, mailto: and tel: URLs).
 */
export function Button(props: ButtonProps) {
  const { variant, size, leading, trailing, className, children, ...rest } = props;
  const classes = buttonClasses({ variant, size, className });
  const content = (
    <>
      {leading}
      {children}
      {trailing}
    </>
  );

  if (props.href !== undefined) {
    const { href, ...anchor } = rest as Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { href: string };
    if (/^(https?:|mailto:|tel:|#)/.test(href)) {
      return (
        <a href={href} className={classes} {...anchor}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...anchor}>
        {content}
      </Link>
    );
  }

  const { type = "button", ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} className={classes} {...button}>
      {content}
    </button>
  );
}
