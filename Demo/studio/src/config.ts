// Everything a client sees that may change: prices, contact, names. Edit here and re-render.
export const CONTACT = { site: "bupulse.com", whatsapp: "+250 791 954 277", cta: "Book a free demo" };

export const PRICES = {
  starter: { rwf: 15000, usd: 12 },
  business: { rwf: 35000, usd: 27 },
};

export const rwf = (n: number) => `${n.toLocaleString("en-US")} RWF`;
