# BuPulse design system

Liquid glass, light + dark, Geist. Source of truth for look: `docs/design/mockup/`. Tokens live in `app/globals.css`.
Helper: `cn()` from `@/lib/cn` (clsx + tailwind-merge).

## Rules

- **Industry-neutral copy.** BuPulse serves every kind of small business (shops, schools, salons, builders, IT, restaurants...). Never write real-estate-only or single-industry copy or examples.
- **44px minimum touch targets** for anything clickable (all components here comply; keep it when composing).
- **Contrast AA.** Body text uses `text-text`; secondary uses `text-muted` (`#5E5E63` light / `#A1A1A6` dark). Don't use Slate `#6E6E73` for small text on glass. White text only on the brand gradient.
- **Reduced motion.** Every animation is disabled by `prefers-reduced-motion` (global rule + per-component). Never convey info through motion alone.
- **Server components by default.** Only Tabs, Accordion, Dialog, Toast, Tilt, Reveal, ThemeProvider/Toggle are `"use client"`.
- Use semantic tokens (`bg-bg`, `text-text`, `border-line`), not raw hex, so dark mode works.

## Theme

`<html>` gets class `dark` (Tailwind variant `dark:`). A tiny inline script in `app/layout.tsx` applies the saved choice (`localStorage["bp-theme"]`) or the system setting before first paint. `ThemeProvider` and `ToastProvider` are already mounted in the root layout.

```tsx
import { ThemeToggle, useTheme } from "@/components/theme";
<ThemeToggle />                       // 44px glass moon/sun button
const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme(); // client only
```

## Tokens

CSS variables (`--bp-*`) switch per theme; Tailwind names map to them.

| Tailwind | Meaning |
| --- | --- |
| `bg-bg` / `bg-surface` | page background (#F5F5F7 / #0B0B0F) / solid surface |
| `bg-glass`, `bg-glass-strong` | translucent surfaces (prefer the `glass` / `glass-strong` utilities, which add border, shadow, blur) |
| `border-line` | hairline border |
| `text-text`, `text-muted` | primary / secondary text |
| `bg-soft` | soft blue/violet tint (hover, tracks) |
| `text-ok bg-ok-bg`, `text-new bg-new-bg` | blue / violet status |
| `text-success bg-success-bg`, `text-danger bg-danger-bg` | success / error |
| `pulse-blue`, `pulse-violet`, `ink`, `cloud`, `graphite`, `slate`, `mist` | fixed brand colors (`bg-pulse-blue`) |

Utilities: `glass`, `glass-strong`, `bg-brand-gradient` (blue to violet), `text-gradient` (animated gradient text).
Radii: `rounded-field` 14, `rounded-card` 24, `rounded-glass` 28, `rounded-panel` 32. Shadows: `shadow-glass`, `shadow-glow`, `shadow-glow-hover`, `shadow-ring`. Easing: `ease-out-soft`. Animations: `animate-float`, `animate-rise`, `animate-shimmer`, `animate-pop`, `animate-ping-soft`, `animate-morph`. Font: `font-sans` (Geist), `font-mono`.

## Brand (`@/components/brand`)

```tsx
<Logo height={36} priority />           // CSS-switched logo.png / logo-white.png, no theme flash
<Mark size={40} variant="mark|icon" alt="" />
```

## UI (`@/components/ui`)

- **Button** `variant: primary|ghost|white|outline`, `size: sm|md|lg`, `href` (next/link; plain `<a>` for http/mailto/tel/#), `leading`, `trailing`, plus native button props. Hover morphs the radius. `buttonClasses()` styles other elements.
  `<Button href="/pricing" size="lg" trailing={<ArrowRight />}>See pricing</Button>`
- **GlassCard** `strong`, `interactive` (lift on hover), `padding: none|sm|md|lg`, `as`.
- **Input / Textarea / Select** native elements, `invalid` prop. Select takes `<option>` children.
- **Label**, **Field** `label`, `hint`, `error`, `required`: wraps ONE control and wires id, `aria-describedby`, `aria-invalid`.
  ```tsx
  <Field label="Email" error={errors.email} required><Input type="email" name="email" /></Field>
  ```
- **Badge** `tone: neutral|blue|violet|success|danger`. **Chip** static pill; with `selected`/`onClick` it is a toggle button (`aria-pressed`); `icon`.
- **Tabs** `items=[{value,label,content}]`, `label` (tablist name), `defaultValue` or `value`+`onValueChange`. Arrow/Home/End keys.
- **Accordion** `items=[{question,answer}]`, `multiple`, `defaultOpen`. Rotating plus icon.
- **Dialog** `open`, `onOpenChange`, `title`, `description` (native `<dialog>`: Esc, focus trap, backdrop click).
- **Toast** `const { toast } = useToast(); toast("Saved", "success")` (`info|success|error`, auto-dismiss 5s).
- **Meter** `value`, `max`, `label`, `showValue`. Gradient bar that grows in; red at 90%+.
- **Avatar** `name`, `src?`, `size`. **Skeleton** size via className. **SectionHeading** `eyebrow`, `title`, `text`, `align`, `as`. **Container** `size: narrow|default|wide`, `as`.

## Motion (`@/components/motion`)

All CSS-first and reduced-motion safe.

- **BackgroundBlobs** `mode: page|section` (fixed behind page, or fill a `relative` parent).
- **PulseLine** `animated`, `strokeWidth`: the heartbeat SVG.
- **Reveal** `as`, `className`: scroll reveal (CSS `animation-timeline: view()`, IntersectionObserver fallback). Content is visible without JS.
- **RotatingWords** `words`, `hold` (seconds): `The marketing team for your <RotatingWords words={["shop.","school.","salon."]} className="text-gradient" />`. Screen readers get all words in a static sr-only span.
- **Marquee** `duration`, `gap`, `reverse`, `pauseOnHover`: loops its children (duplicate is `aria-hidden`).
- **Float** `delay`, `duration`; **Tilt** `max` (mouse/pen only).
