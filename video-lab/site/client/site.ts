// Shared by every studio page: the active nav link, the mobile menu, the language switcher, the wallet chip and the
// lab notice.
import { applyLang, currentLang, setLang, type Lang } from "./i18n";
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], "style">> & { style?: string };
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const { style, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest as unknown as Partial<HTMLElementTagNameMap[K]>);
  if (style) node.style.cssText = style;
  node.append(...children);
  return node;
};
export const api = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !(body as { jobs?: unknown }).jobs) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
};
export type Session = { kind: "owner" } | { kind: "client"; businessId: string; businessName: string; role: string };
let sessionRequest: Promise<Session> | null = null;
/** Who is using the studio: the owner (every business, test tools) or a client (their own business only). */
export const getSession = () => (sessionRequest ??= api<Session>("/api/session").catch(() => ({ kind: "owner" }) as Session));
/** The businesses the page may offer: a client's own (no picker), or every business for the owner. */
export async function loadBusinesses(): Promise<{ id: string; name: string }[]> {
  const s = await getSession();
  return s.kind === "client" ? [{ id: s.businessId, name: s.businessName }] : api<{ id: string; name: string }[]>("/api/businesses");
}
export const credits = (n: number) => `${n.toLocaleString()} credits`;
export const rwf = (n: number) => `${n.toLocaleString()} RWF`;

export type Wallet = { balance: number; spent: number };
export async function refreshWallet(): Promise<Wallet | null> {
  try {
    const w = await api<Wallet>("/api/wallet");
    const chip = document.getElementById("walletChip");
    if (chip) chip.textContent = `✦ ${w.balance.toLocaleString()} credits`;
    return w;
  } catch {
    return null;
  }
}

(function start() {
  const page = document.body.dataset.page;
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === page));
  const toggle = document.getElementById("navToggle");
  if (toggle)
    toggle.onclick = () => {
      const open = document.body.classList.toggle("navOpen");
      toggle.setAttribute("aria-expanded", String(open));
    };
  document.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang as Lang)));
  applyLang(currentLang());
  void refreshWallet();
  // The notice bar: whether Seedance is connected (or why not, checked by the server every 5 minutes) and how Claude
  // is reached.
  // A client's pages hide the owner's links (viral library, API page, developer lab) and the test notices.
  void getSession().then((sess) => {
    document.body.dataset.kind = sess.kind;
  });
  void Promise.all([api<{ claudeMode?: string }>("/api/options"), api<{ state: string; message: string }>("/api/seedance/status").catch(() => null)]).then(([o, sd]) => {
    const n = document.getElementById("labNotice");
    if (!n) return;
    const parts = [];
    if (sd?.state === "connected") parts.push("Seedance connected.");
    else if (sd?.state === "no key") parts.push("Seedance runs in free preview mode (storyboards with the price) until the BytePlus key is added.");
    else if (sd) parts.push(`Seedance: ${sd.message}`);
    // The subscription reminder has its own bar (it must never be missed); API mode shows no bar.
    const mode = document.getElementById("modeBar");
    if (mode) mode.hidden = o.claudeMode !== "subscription";
    if (parts.length) {
      n.textContent = parts.join("  ·  ");
      n.classList.add("show");
    }
  });
})();
