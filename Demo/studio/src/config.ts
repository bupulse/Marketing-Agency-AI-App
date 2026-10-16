// Everything a client sees that may change: prices, contact, names. Edit here and re-render.
export const CONTACT = { site: "bupulse.com", whatsapp: "+250 791 954 277", cta: "Book a free demo" };

export const PRICES = {
  starter: { rwf: 15000, usd: 12 },
  business: { rwf: 50000, usd: 39 }, // v2 (14 Oct 2026): 50,000 RWF a month; card 50,000 / 1,450 x 1.12, rounded up
};

export const rwf = (n: number) => `${n.toLocaleString("en-US")} RWF`;
