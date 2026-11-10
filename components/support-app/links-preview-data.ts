import { staffTotals, type LinkRow, type LinksReport } from "@/lib/links/service";

// Made-up links for the support app's dev-only preview (app/support/preview/links): no database.

const row = (id: string, label: string, channel: string, destination: string, by: LinkRow["by"], s: Partial<LinkRow["stats"]>, archived = false): LinkRow => ({
  id,
  code: id,
  label,
  channel,
  destination,
  createdAt: "2026-11-02T09:00:00.000Z",
  archived,
  by,
  stats: { clicks: 0, visitors: 0, quotes: 0, chats: 0, signups: 0, paid: 0, countries: [], ...s },
});

const company = { id: "owner", name: "Admin", owner: true };
const jean = { id: "jean", name: "Jean Mugisha", owner: false };

export function previewLinksReport(owner: boolean): LinksReport {
  const links = [
    row("ig-bio", "Instagram bio", "instagram", "/quote", company, { clicks: 412, visitors: 301, quotes: 18, chats: 9, signups: 4, paid: 1, countries: [{ country: "RW", clicks: 380 }, { country: "UG", clicks: 21 }, { country: "KE", clicks: 8 }] }),
    row("tiktok-nov", "TikTok video", "tiktok", "/", company, { clicks: 198, visitors: 160, quotes: 6, chats: 3, signups: 1, countries: [{ country: "RW", clicks: 170 }] }),
    row("jean-wa-7k2q", "My WhatsApp status", "whatsapp", "/quote", jean, { clicks: 64, visitors: 51, quotes: 7, chats: 2, signups: 2, paid: 1, countries: [{ country: "RW", clicks: 64 }] }),
    row("poster-kimironko", "Poster at Kimironko", "print", "/pricing", company, { clicks: 12, visitors: 10 }, true),
  ];
  const visible = owner ? links : links.filter((l) => l.by.id === "jean");
  return {
    links: visible,
    staff: owner ? staffTotals(visible, new Map([["aline", { name: "Aline Uwase", count: 5 }], ["jean", { name: "Jean Mugisha", count: 2 }]])) : null,
    myChatLeads: owner ? 0 : 2,
    visitorsFrom: null,
  };
}
