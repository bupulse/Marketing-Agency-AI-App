// The support chat's motion, in the spirit of the BuPulse agency's Website Creator chat: messages rising in (the
// visitor's from the left, ours popping from the right), an AI answer fading in word by word, a shimmering "thinking"
// line, bouncing typing dots, inbox rows flashing when they change, menus and chips popping. Plain CSS kept with the
// component (app/globals.css stays as it is), and nothing moves for people who ask for less motion.

const CSS = `
@keyframes sc-rise { from { opacity: 0; transform: translateY(10px) scale(.985) } to { opacity: 1; transform: none } }
@keyframes sc-pop { 0% { opacity: 0; transform: translateY(12px) scale(.94) } 65% { opacity: 1; transform: translateY(-2px) scale(1.01) } 100% { opacity: 1; transform: none } }
@keyframes sc-in-left { 0% { opacity: 0; transform: translate(-10px, 8px) scale(.96) } 70% { opacity: 1; transform: translate(1px, -1px) scale(1.005) } 100% { opacity: 1; transform: none } }
@keyframes sc-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes sc-word { from { opacity: 0; filter: blur(2px) } to { opacity: 1; filter: none } }
@keyframes sc-shimmer { from { background-position: 100% 0 } to { background-position: 0% 0 } }
@keyframes sc-dot { 0%, 60%, 100% { opacity: .35; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-4px) } }
@keyframes sc-spin { to { transform: rotate(360deg) } }
@keyframes sc-flash { 0% { background-color: rgba(47,107,255,.18) } 100% { background-color: transparent } }
@keyframes sc-ping { 0% { transform: scale(1); opacity: .7 } 80%, 100% { transform: scale(2.4); opacity: 0 } }
@keyframes sc-slide-in { from { opacity: 0; transform: translateX(16px) } to { opacity: 1; transform: none } }
@keyframes sc-slide-back { from { opacity: 0; transform: translateX(-16px) } to { opacity: 1; transform: none } }
.sc-rise { animation: sc-rise .45s cubic-bezier(.2,.8,.2,1) both }
.sc-pop { animation: sc-pop .42s cubic-bezier(.2,.8,.2,1) both; transform-origin: 100% 100% }
.sc-in-left { animation: sc-in-left .45s cubic-bezier(.2,.8,.2,1) both; transform-origin: 0% 100% }
.sc-menu { animation: sc-pop .22s cubic-bezier(.2,.8,.2,1) both; transform-origin: 50% 100% }
.sc-fade { animation: sc-fade .35s ease-out both }
.sc-word { animation: sc-word .5s ease-out both }
.sc-flash { animation: sc-flash 1.6s ease-out both }
.sc-slide-in { animation: sc-slide-in .32s cubic-bezier(.2,.8,.2,1) both }
.sc-slide-back { animation: sc-slide-back .32s cubic-bezier(.2,.8,.2,1) both }
.sc-shimmer {
  color: transparent;
  background: linear-gradient(90deg, var(--bp-muted) 0%, var(--bp-muted) 38%, var(--bp-text) 50%, var(--bp-muted) 62%, var(--bp-muted) 100%) 0 0 / 250% 100%;
  -webkit-background-clip: text; background-clip: text;
  animation: sc-shimmer 2.2s linear infinite;
}
.sc-dot { animation: sc-dot 1.2s ease-in-out infinite }
.sc-dot:nth-child(2) { animation-delay: .15s }
.sc-dot:nth-child(3) { animation-delay: .3s }
.sc-spin { animation: sc-spin .8s linear infinite }
.sc-ping { animation: sc-ping 1.6s cubic-bezier(0,0,.2,1) infinite }
.sc-stagger > * { animation: sc-rise .42s cubic-bezier(.2,.8,.2,1) both }
.sc-stagger > *:nth-child(2) { animation-delay: 40ms }
.sc-stagger > *:nth-child(3) { animation-delay: 80ms }
.sc-stagger > *:nth-child(4) { animation-delay: 120ms }
.sc-stagger > *:nth-child(5) { animation-delay: 160ms }
.sc-stagger > *:nth-child(6) { animation-delay: 200ms }
.sc-stagger > *:nth-child(7) { animation-delay: 240ms }
.sc-stagger > *:nth-child(n+8) { animation-delay: 280ms }
.sc-send { transition: transform .2s cubic-bezier(.2,.8,.2,1), opacity .2s, box-shadow .2s, background-color .2s }
.sc-send:not(:disabled):hover { transform: translateY(-1px) scale(1.06) }
.sc-send:not(:disabled):active { transform: scale(.92) }
.sc-send[data-ready="true"] svg { animation: sc-pop .35s cubic-bezier(.2,.8,.2,1) both }
.sc-scroll { scrollbar-width: thin; scrollbar-color: var(--bp-line) transparent }
@media (prefers-reduced-motion: reduce) {
  .sc-rise, .sc-pop, .sc-in-left, .sc-menu, .sc-fade, .sc-word, .sc-flash, .sc-slide-in, .sc-slide-back, .sc-stagger > *, .sc-dot, .sc-spin, .sc-ping, .sc-send[data-ready="true"] svg { animation: none !important }
  .sc-shimmer { animation: none; background: none; color: var(--bp-muted) }
  .sc-send, .sc-send:not(:disabled):hover, .sc-send:not(:disabled):active { transition: none; transform: none }
}
`;

/** The chat screens' keyframes; React hoists one copy into <head> however many times it renders. */
export function ChatStyles() {
  return (
    <style href="bp-support-chat" precedence="default">
      {CSS}
    </style>
  );
}

/** Text that shimmers while something is running ("Rewriting…", "The AI is writing…"). */
export function Shimmer({ children, on = true }: { children: React.ReactNode; on?: boolean }) {
  return <span className={on ? "sc-shimmer" : undefined}>{children}</span>;
}

/** Three bouncing dots: someone is typing. */
export function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-flex items-center gap-[3px] ${className}`}>
      <span className="sc-dot size-[6px] rounded-full bg-current" />
      <span className="sc-dot size-[6px] rounded-full bg-current" />
      <span className="sc-dot size-[6px] rounded-full bg-current" />
    </span>
  );
}

/** A small live dot with a soft ping around it. */
export function LiveDot({ className = "bg-success" }: { className?: string }) {
  return (
    <span aria-hidden className="relative inline-flex size-2 shrink-0">
      <span className={`sc-ping absolute inset-0 rounded-full ${className}`} />
      <span className={`relative size-2 rounded-full ${className}`} />
    </span>
  );
}
