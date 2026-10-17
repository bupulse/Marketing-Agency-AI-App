// Pricing: packs (test wallet top-ups), the Seedance rate table and the wallet.
import { type Pricing } from "./models";
import { $, api, el, refreshWallet, rwf } from "./site";

async function start() {
  const p = await api<Pricing>("/api/pricing");
  const packs = $("packs");
  for (const pack of p.packs) {
    const buy = el("button", { className: "btn primary", textContent: "Buy (test: adds credits)" });
    const done = el("p", { className: "hint ok" });
    buy.onclick = async () => {
      buy.disabled = true;
      try {
        await api("/api/wallet/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack: pack.id }) });
        done.textContent = `+${pack.credits.toLocaleString()} test credits added.`;
        await refreshWallet();
        await wallet();
      } catch (e) {
        done.textContent = (e as Error).message;
      } finally {
        buy.disabled = false;
      }
    };
    packs.append(el("div", { className: `card pack${pack.popular || location.hash === `#pack-${pack.id}` ? " hl" : ""}`, id: `pack-${pack.id}` }, el("h3", { textContent: pack.name }), el("div", { className: "amount", textContent: rwf(pack.rwf) }), el("div", { className: "per", textContent: `${pack.credits.toLocaleString()} credits` }), el("p", { className: "muted", textContent: pack.blurb }), buy, done));
  }
  if (location.hash.startsWith("#pack-")) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "center" });
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
