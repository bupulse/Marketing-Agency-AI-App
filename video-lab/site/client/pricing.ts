// Pricing: packs (test wallet top-ups), the Seedance rate table and the wallet.
import { $, api, el, refreshWallet, rwf } from "./site";

type Pricing = { packs: { id: string; name: string; credits: number; rwf: number; blurb: string; popular?: boolean }[]; seedance: { tier: string; name: string; resolution: string; credits5s: number; credits10s: number; credits15s: number }[]; claudeCredits: number; presenterCredits: number };

async function start() {
  const p = await api<Pricing>("/api/pricing");
  const packs = $("packs");
  for (const pack of p.packs) {
    const buy = el("button", { className: "btn primary", textContent: "Buy (test: adds credits)" });
    buy.onclick = async () => {
      buy.disabled = true;
      await api("/api/wallet/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack: pack.id }) });
      await refreshWallet();
      await wallet();
      buy.disabled = false;
    };
    packs.append(el("div", { className: `card pack${pack.popular ? " hl" : ""}` }, el("h3", { textContent: pack.name }), el("div", { className: "amount", textContent: rwf(pack.rwf) }), el("div", { className: "per", textContent: `${pack.credits.toLocaleString()} credits` }), el("p", { className: "muted", textContent: pack.blurb }), buy));
  }
  const t = $("rates");
  t.append(el("tr", {}, ...["Quality", "Resolution", "5 s", "10 s", "15 s"].map((h) => el("th", { textContent: h }))));
  for (const r of p.seedance) t.append(el("tr", {}, el("td", { textContent: r.name }), el("td", { textContent: r.resolution }), el("td", { textContent: `${r.credits5s}` }), el("td", { textContent: `${r.credits10s}` }), el("td", { textContent: `${r.credits15s}` })));
  $("clCredits").textContent = String(p.claudeCredits);
  $("presCredits").textContent = String(p.presenterCredits);
  await wallet();
}

async function wallet() {
  const w = await api<{ balance: number; spent: number; history: { at: string; delta: number; note: string }[] }>("/api/wallet");
  const rows: [string, string][] = [["Balance", `${w.balance.toLocaleString()} credits`], ["Spent", `${w.spent.toLocaleString()} credits`], ...w.history.slice(-8).reverse().map((h): [string, string] => [new Date(h.at).toLocaleString(), `${h.delta > 0 ? "+" : ""}${h.delta} · ${h.note}`])];
  $("walletInfo").replaceChildren(...rows.flatMap(([k, v]) => [el("span", { className: "k", textContent: k }), el("span", { textContent: v })]));
}
void start();
