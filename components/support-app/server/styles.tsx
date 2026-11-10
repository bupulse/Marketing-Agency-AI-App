// The Server page's animations: cards rising in, gauges filling, bars growing, the status pulse, the checking spinner.
// Plain CSS in a scoped <style>, and nothing moves for people who ask for less motion.

const CSS = `
@keyframes srv-rise { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
@keyframes srv-ring { from { stroke-dasharray: 0 100 } }
@keyframes srv-grow-x { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes srv-grow-y { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes srv-ping { 0% { transform: scale(1); opacity: .55 } 80%, 100% { transform: scale(2.1); opacity: 0 } }
@keyframes srv-blink { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes srv-spin { to { transform: rotate(360deg) } }
@keyframes srv-sweep { from { transform: translateX(-100%) } to { transform: translateX(250%) } }
@keyframes srv-pop { 0% { opacity: 0; transform: translateY(8px) scale(.97) } 70% { opacity: 1; transform: translateY(-1px) scale(1.005) } 100% { opacity: 1; transform: none } }
.srv-rise { animation: srv-rise .5s cubic-bezier(.2,.8,.2,1) both }
.srv-stagger > * { animation: srv-rise .5s cubic-bezier(.2,.8,.2,1) both }
.srv-stagger > *:nth-child(2) { animation-delay: .06s }
.srv-stagger > *:nth-child(3) { animation-delay: .12s }
.srv-stagger > *:nth-child(4) { animation-delay: .18s }
.srv-stagger > *:nth-child(5) { animation-delay: .24s }
.srv-stagger > *:nth-child(n+6) { animation-delay: .3s }
.srv-ring { animation: srv-ring 1.1s cubic-bezier(.2,.8,.2,1) both }
.srv-grow-x { transform-origin: 0 50%; animation: srv-grow-x .9s cubic-bezier(.2,.8,.2,1) both }
.srv-grow-y { transform-origin: 50% 100%; transform-box: fill-box; animation: srv-grow-y .7s cubic-bezier(.2,.8,.2,1) both }
.srv-ping { animation: srv-ping 2.2s cubic-bezier(0,0,.2,1) infinite }
.srv-ping-late { animation: srv-ping 2.2s cubic-bezier(0,0,.2,1) 1.1s infinite }
.srv-blink { animation: srv-blink 1.6s ease-in-out infinite }
.srv-spin { animation: srv-spin .9s linear infinite }
.srv-sweep { animation: srv-sweep 1.3s ease-in-out infinite }
.srv-pop { animation: srv-pop .45s cubic-bezier(.2,.8,.2,1) both }
@media (prefers-reduced-motion: reduce) {
  .srv-rise, .srv-stagger > *, .srv-ring, .srv-grow-x, .srv-grow-y, .srv-pop { animation: none !important }
  .srv-ping, .srv-ping-late, .srv-sweep { animation: none !important; opacity: 0 }
  .srv-blink, .srv-spin { animation: none !important }
}
`;

export function ServerStyles() {
  return <style href="bp-support-server" precedence="default">{CSS}</style>;
}
