// The kit's few animations, in one component-scoped <style> (React hoists it once, however many pieces render it).
// All of it is switched off under prefers-reduced-motion.

const CSS = `
@keyframes kit-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes kit-pop { 0% { transform: scale(.85) } 70% { transform: scale(1.06) } 100% { transform: none } }
@keyframes kit-sheet { from { transform: translateY(100%) } to { transform: none } }
@keyframes kit-fade { from { opacity: 0 } to { opacity: 1 } }
.kit-rise > * { animation: kit-rise .42s cubic-bezier(.2,.8,.2,1) both }
.kit-rise > *:nth-child(2) { animation-delay: .04s } .kit-rise > *:nth-child(3) { animation-delay: .08s }
.kit-rise > *:nth-child(4) { animation-delay: .12s } .kit-rise > *:nth-child(5) { animation-delay: .16s }
.kit-rise > *:nth-child(n+6) { animation-delay: .2s }
.kit-pop { animation: kit-pop .3s cubic-bezier(.2,.8,.2,1) both }
.kit-sheet[open] { animation: kit-sheet .32s cubic-bezier(.2,.8,.2,1) both }
.kit-sheet[open]::backdrop { animation: kit-fade .25s ease-out both }
.kit-sheet::backdrop { background: rgba(11, 11, 15, .45); backdrop-filter: blur(2px) }
@media (prefers-reduced-motion: reduce) {
  .kit-rise > *, .kit-pop, .kit-sheet[open], .kit-sheet[open]::backdrop { animation: none !important }
}
`;

export function KitStyles() {
  return (
    <style href="bp-admin-kit" precedence="default">
      {CSS}
    </style>
  );
}
