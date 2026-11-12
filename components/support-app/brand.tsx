import { BrandLockup } from "@/components/brand/lockup";

/**
 * The support app's brand: BuPulse's real logo and "Support" (components/brand/lockup.tsx). Always the white wordmark:
 * it sits on the brand gradient in light mode and on the dark tone in dark mode (sidebar, phone bar, sign-in pages).
 */
export function SupportBrand({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return <BrandLockup service="Support" tone="white" height={size === "lg" ? 36 : 28} eager className={className} />;
}
