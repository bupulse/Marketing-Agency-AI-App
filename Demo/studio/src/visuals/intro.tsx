import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { rwf } from "../config";
import { BIZ, PLAN_PRICE, type Biz } from "../data";
import { lineStart, useScene } from "../scene-context";
import { EndCard as EndCardScene } from "../scenes/EndCard";
import { C, fontFamily } from "../theme";
import { pop, prog, rise } from "../ui/motion";
import { Avatar, Badge, Button, Callout, Cursor, Glass, Logo } from "../ui/primitives";
import { Grad, SceneLayout } from "../ui/SceneLayout";
import { Sfx } from "../ui/Sfx";

export { Screen, Landing, LandingFeatures, SignUp, Onboarding, Dashboard } from "./screens";

export const EndCard: React.FC = () => <EndCardScene />;

/** A finished social post tile for a business, used in montages. */
const PostTile: React.FC<{ biz: Biz; i?: number; w?: number; style?: React.CSSProperties }> = ({ biz, i = 0, w = 300, style }) => {
  const p = biz.products[i];
  const label = { inzu: "New arrival", urugo: "Just listed", nova: "In stock now" }[biz.key];
  return (
    <div style={{ width: w, borderRadius: 26, overflow: "hidden", background: "white", boxShadow: "0 30px 80px rgba(29,29,31,0.18)", fontFamily, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
        <Avatar name={biz.name} size={34} color={biz.colors[0]} />
        <div style={{ fontSize: 16, fontWeight: 600 }}>{biz.name.toLowerCase().replace(/ /g, "")}</div>
      </div>
      <div style={{ height: w, background: `linear-gradient(150deg, ${biz.colors[0]}, ${biz.colors[1]})`, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 22, color: "white" }}>
        <div style={{ fontSize: w * 0.06, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", opacity: 0.9 }}>{label}</div>
        <div style={{ fontSize: w * 0.3, textAlign: "center" }}>{p.emoji}</div>
        <div>
          <div style={{ fontSize: w * 0.075, fontWeight: 700, lineHeight: 1.15 }}>{p.name}</div>
          <div style={{ marginTop: 8, display: "inline-block", background: "white", color: biz.colors[0], fontWeight: 700, fontSize: w * 0.06, padding: "6px 12px", borderRadius: 999 }}>{p.price}</div>
        </div>
      </div>
      <div style={{ padding: "12px 16px", fontSize: 15, color: C.muted }}>♥ 248 · 💬 31 · ↗ 12</div>
    </div>
  );
};

/** Opening: the problem in big type, then BuPulse and finished posts floating in. */
export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = useScene();
  const vertical = height > width;
  const l1 = lineStart(s, 0), l2 = lineStart(s, 1), l3 = lineStart(s, 2);
  const out1 = prog(f, l2 - 8, 10);
  const out2 = prog(f, l3 - 8, 10);
  const hours = Math.min(5, Math.floor(interpolate(f, [l1, l2], [0, 6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const tiles = [BIZ.inzu, BIZ.urugo, BIZ.nova];
  return (
    <AbsoluteFill style={{ fontFamily, color: C.text, alignItems: "center", justifyContent: "center" }}>
      <Sfx name="whoosh" at={l3} volume={0.35} />
      {f < l2 && (
        <div style={{ textAlign: "center", opacity: 1 - out1, transform: `scale(${1 - out1 * 0.05})` }}>
          <div style={{ ...rise(f, l1), fontSize: vertical ? 92 : 104, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05, padding: "0 60px" }}>
            Posting every day<br />takes <Grad>hours.</Grad>
          </div>
          <div style={{ ...rise(f, l1 + 10), marginTop: 40, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", padding: "0 40px" }}>
            {["Write the caption", "Design the photo", "Pick the time", "Post on every page"].map((t, i) => (
              <Glass key={t} pad={18} radius={20} style={{ ...rise(f, l1 + 14 + i * 6), fontSize: vertical ? 30 : 26, fontWeight: 500 }}>⏱ {t}</Glass>
            ))}
          </div>
          <div style={{ ...rise(f, l1 + 30), marginTop: 36, fontSize: vertical ? 40 : 34, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{hours}h spent this week…</div>
        </div>
      )}
      {f >= l2 - 2 && f < l3 && (
        <div style={{ position: "absolute", textAlign: "center", opacity: prog(f, l2, 10) * (1 - out2), padding: "0 60px" }}>
          <div style={{ fontSize: vertical ? 96 : 110, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05 }}>
            What if your marketing<br /><Grad>ran itself?</Grad>
          </div>
        </div>
      )}
      {f >= l3 - 2 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: vertical ? 70 : 46 }}>
            <div style={{ transform: `scale(${0.7 + 0.3 * pop(f, fps, l3)})`, opacity: prog(f, l3, 10) }}><Logo height={vertical ? 120 : 110} /></div>
            <div style={{ ...rise(f, l3 + 8), fontSize: vertical ? 44 : 40, fontWeight: 500, color: C.muted, textAlign: "center", padding: "0 60px" }}>The AI marketing assistant for small businesses</div>
            <div style={{ display: "flex", gap: vertical ? 24 : 40, flexDirection: vertical ? "column" : "row", alignItems: "center" }}>
              {(vertical ? tiles.slice(0, 2) : tiles).map((b, i) => (
                <div key={b.key} style={{ transform: `translateY(${(1 - pop(f, fps, l3 + 14 + i * 7)) * 260}px) rotate(${(i - 1) * 3}deg)`, opacity: prog(f, l3 + 14 + i * 7, 8) }}>
                  <PostTile biz={b} w={vertical ? 300 : 280} />
                </div>
              ))}
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

/** Demo only: why posting is hard, and the four languages. */
export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const l2 = lineStart(s, 1);
  const channels = [
    { name: "Instagram", color: "linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)" },
    { name: "Facebook", color: "#1877F2" },
    { name: "WhatsApp", color: "#25D366" },
  ];
  const tasks = ["✍️ Writing", "🎨 Designing", "🕕 Timing"];
  return (
    <SceneLayout eyebrow="Why BuPulse" title={<>Good posts take <Grad>time.</Grad></>} text="BuPulse does the work, in your language.">
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 30, justifyContent: "center", padding: 40 }}>
        <div style={{ display: "flex", gap: 22, justifyContent: "center" }}>
          {channels.map((c, i) => (
            <Glass key={c.name} pad={24} style={{ ...rise(f, 8 + i * 6), display: "flex", alignItems: "center", gap: 16, width: 300 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: c.color }} />
              <div style={{ fontSize: 28, fontWeight: 600 }}>{c.name}</div>
            </Glass>
          ))}
        </div>
        <div style={{ display: "flex", gap: 22, justifyContent: "center" }}>
          {tasks.map((t, i) => {
            const done = prog(f, l2 + i * 6, 10);
            return (
              <Glass key={t} pad={22} style={{ ...rise(f, 30 + i * 8), width: 300, fontSize: 28, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{t}</span>
                <span style={{ opacity: done, color: C.success, fontSize: 26 }}>✓ BuPulse</span>
              </Glass>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 10 }}>
          {["English", "Kinyarwanda", "Français", "Kiswahili"].map((l, i) => (
            <div key={l} style={{ ...rise(f, l2 + 20 + i * 5), background: C.gradient, color: "white", fontWeight: 600, fontSize: 26, padding: "14px 26px", borderRadius: 999 }}>{l}</div>
          ))}
        </div>
      </div>
    </SceneLayout>
  );
};

type PlanCardProps = { name: string; price: string; sub: string; features: string[]; highlight?: boolean; badge?: string; cta: string; style?: React.CSSProperties; active?: boolean };
const PlanCard: React.FC<PlanCardProps> = ({ name, price, sub, features, highlight, badge, cta, style, active }) => (
  <div style={{ position: "relative", width: 330, borderRadius: 28, padding: 28, background: highlight ? "white" : C.glassStrong, border: highlight ? "2px solid transparent" : `1px solid ${C.line}`, backgroundClip: "padding-box", boxShadow: active ? "0 0 0 4px rgba(47,107,255,0.55), 0 30px 80px rgba(47,107,255,0.25)" : "0 24px 70px rgba(29,29,31,0.10)", display: "flex", flexDirection: "column", gap: 16, ...style }}>
    {badge && <div style={{ position: "absolute", top: -16, left: 28 }}><Badge tone="violet" style={{ background: C.gradient, color: "white" }}>{badge}</Badge></div>}
    <div style={{ fontSize: 28, fontWeight: 700 }}>{name}</div>
    <div>
      <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{price}</div>
      <div style={{ fontSize: 18, color: C.muted, marginTop: 4 }}>{sub}</div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 170 }}>
      {features.map((x) => <div key={x} style={{ fontSize: 19, display: "flex", gap: 10 }}><span style={{ color: C.blue, fontWeight: 700 }}>✓</span>{x}</div>)}
    </div>
    <Button variant={highlight ? "primary" : "outline"} style={{ width: "100%" }}>{cta}</Button>
  </div>
);

const RW_PLANS: PlanCardProps[] = [
  { name: "Starter", price: rwf(PLAN_PRICE.starter.rwf), sub: `per month · card $${PLAN_PRICE.starter.usd}`, features: ["60 AI texts a month", "30 brand designs", "Calendar & scheduling", "Photo gallery"], cta: "Choose Starter" },
  { name: "Business", price: rwf(PLAN_PRICE.business.rwf), sub: `per month · card $${PLAN_PRICE.business.usd}`, features: ["200 AI texts a month", "100 AI photo designs", "120 voiced videos a month", "Website chat and leads", "3 team members"], highlight: true, badge: "Most popular", cta: "Choose Business" },
  { name: "Custom", price: "Your plan", sub: "built after a short call", features: ["Autopilot", "More AI photo designs", "Analytics", "Managed by our team"], cta: "Book a call" },
];

/** Rwanda pricing page with RWF prices and payment badges. */
export const PricingRW: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const l2 = lineStart(s, 1), l3 = lineStart(s, 2);
  const focus = s.lines.length >= 3 ? (f < l2 ? -1 : f < l3 ? 1 : 2) : -1;
  return (
    <SceneLayout eyebrow="Pricing for Rwanda" title={<>Prices in <Grad>Rwandan francs.</Grad></>} text="Pay with Mobile Money or card. No contract.">
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34 }}>
        <div style={{ ...rise(f, 4), display: "flex", gap: 12 }}>
          <Badge tone="neutral" style={{ fontSize: 20, padding: "10px 18px" }}>🇷🇼 Prices for Rwanda</Badge>
          <Badge tone="success" style={{ fontSize: 20, padding: "10px 18px" }}>📱 Mobile Money</Badge>
          <Badge tone="blue" style={{ fontSize: 20, padding: "10px 18px" }}>💳 Card</Badge>
        </div>
        <div style={{ display: "flex", gap: 26, alignItems: "stretch" }}>
          {RW_PLANS.map((p, i) => (
            <PlanCard key={p.name} {...p} active={focus === i || (focus === 1 && i === 0)} style={{ ...rise(f, 10 + i * 6, 40) }} />
          ))}
        </div>
      </div>
    </SceneLayout>
  );
};

/** The three plans with a spotlight moving across them. */
export const PlanPick: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const step = Math.min(2, Math.floor(interpolate(f, [s.voiceEnd * 0.45, s.durationInFrames - 10], [0, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const started = f > s.voiceEnd * 0.45;
  const xs = [195, 551, 907];
  return (
    <SceneLayout eyebrow="Choose your plan" title={<>Which plan <Grad>fits you?</Grad></>} text="Let's look at each one.">
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 26 }}>
        {RW_PLANS.map((p, i) => (
          <PlanCard key={p.name} {...p} active={started && step === i} style={{ ...rise(f, 4 + i * 5, 40), transform: `scale(${started && step === i ? 1.04 : 0.97})`, transition: "none" }} />
        ))}
        {started && <Sfx name="click" at={s.voiceEnd * 0.45} volume={0.3} />}
        <Cursor path={[[0, 1000, 700], [Math.round(s.voiceEnd * 0.45), xs[0], 650], [Math.round(s.voiceEnd * 0.45 + (s.durationInFrames - s.voiceEnd * 0.45) / 3), xs[1], 650], [Math.round(s.voiceEnd * 0.45 + (2 * (s.durationInFrames - s.voiceEnd * 0.45)) / 3), xs[2], 650]]} />
      </div>
    </SceneLayout>
  );
};

/** "Meet Aline": the business owner and their shop. */
export const Persona: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const biz = BIZ[s.arg as Biz["key"]];
  const first = biz.owner.split(" ")[0];
  return (
    <SceneLayout eyebrow={`${biz.plan} plan`} title={<>Meet <Grad>{first}</Grad>.</>} text={`${biz.name} · ${biz.place}`}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 40 }}>
        <Glass pad={34} style={{ ...rise(f, 4, 40), width: 440, display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ transform: `scale(${pop(f, fps, 6)})` }}><Avatar name={biz.owner} size={96} color={biz.colors[0]} /></div>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{biz.owner}</div>
              <div style={{ fontSize: 22, color: C.muted }}>{biz.role}, {biz.name}</div>
            </div>
          </div>
          <div style={{ height: 1, background: C.line }} />
          {[["📍", biz.place], ["🛍", biz.what], ["📞", biz.phone]].map(([i, t], k) => (
            <div key={t} style={{ ...rise(f, 14 + k * 6), fontSize: 23, display: "flex", gap: 14 }}><span>{i}</span>{t}</div>
          ))}
          <div style={{ ...rise(f, 34) }}><Badge tone="violet" style={{ fontSize: 20, padding: "8px 16px" }}>{biz.plan} plan</Badge></div>
        </Glass>
        <div style={{ position: "relative", width: 380, height: 560 }}>
          {biz.products.slice(0, 2).map((_, i) => (
            <div key={i} style={{ position: "absolute", left: i * 90, top: i * 120, transform: `rotate(${i ? 5 : -4}deg) translateY(${(1 - pop(f, fps, 16 + i * 10)) * 200}px)`, opacity: prog(f, 16 + i * 10, 8) }}>
              <PostTile biz={biz} i={i} w={260} />
            </div>
          ))}
        </div>
      </div>
    </SceneLayout>
  );
};

/** End-of-plan nudge to the next plan. */
export const Upsell: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const toCustom = s.arg === "custom";
  const from = toCustom ? RW_PLANS[1] : RW_PLANS[0];
  const to = toCustom ? [RW_PLANS[2]] : [RW_PLANS[1], RW_PLANS[2]];
  return (
    <SceneLayout eyebrow="Grow when you're ready" title={toCustom ? <>Want <Grad>more?</Grad></> : <>Need <Grad>more?</Grad></>} text={toCustom ? "Autopilot, our team and more, in a custom plan." : "Upgrade any time. Nothing is lost."}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <PlanCard {...from} style={{ ...rise(f, 4), opacity: 0.55, transform: "scale(0.92)" }} cta="Current plan" />
        <div style={{ ...rise(f, 14), fontSize: 50, color: C.blue }}>→</div>
        {to.map((p, i) => <PlanCard key={p.name} {...p} highlight={i === 0} active={i === 0 && f > 30} style={rise(f, 20 + i * 8, 40)} />)}
      </div>
      {f > 30 && <Callout at={30} x={toCustom ? 640 : 470} y={60}>{toCustom ? "Talk to us →" : "Upgrade in one click"}</Callout>}
    </SceneLayout>
  );
};

const CHAPTER_INFO: Record<string, { part: string; name: string; price: string; who: string; color: string }> = {
  starter: { part: "Part 1", name: "Starter", price: `${rwf(PLAN_PRICE.starter.rwf)} / month`, who: "with Inzu Fashion, a boutique in Kimironko", color: BIZ.inzu.colors[0] },
  business: { part: "Part 2", name: "Business", price: `${rwf(PLAN_PRICE.business.rwf)} / month`, who: "with Urugo Homes, a real estate agency", color: BIZ.urugo.colors[0] },
  custom: { part: "Part 3", name: "Custom", price: "Built around your business", who: "with Nova Phones Kigali", color: BIZ.nova.colors[0] },
  card: { part: "Part 4", name: "Paying by card", price: "Renews automatically every month", who: "Mobile Money or card: your choice", color: C.violet },
};

/** Title card before each part of the full walkthrough. */
export const Chapter: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const vertical = height > width;
  const s = useScene();
  const c = CHAPTER_INFO[s.arg];
  const p = pop(f, fps, 2, 16);
  return (
    <AbsoluteFill style={{ fontFamily, color: C.text, alignItems: "center", justifyContent: "center" }}>
      <Sfx name="whoosh" at={0} volume={0.3} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: vertical ? 34 : 26, textAlign: "center", padding: "0 70px", transform: `scale(${0.9 + 0.1 * p})`, opacity: Math.min(1, p * 1.4) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: vertical ? 34 : 28, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: C.blue }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: c.color }} />
          {c.part}
        </div>
        <div style={{ fontSize: vertical ? 130 : 132, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}><Grad>{c.name}</Grad></div>
        <div style={{ ...rise(f, 10), fontSize: vertical ? 50 : 44, fontWeight: 600 }}>{c.price}</div>
        <div style={{ ...rise(f, 16), fontSize: vertical ? 36 : 32, color: C.muted }}>{c.who}</div>
      </div>
    </AbsoluteFill>
  );
};
