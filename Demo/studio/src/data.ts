// The fictional demo businesses and the numbers shown on screen. Prices come from config.ts.
import { PRICES } from "./config";

export type Biz = {
  key: "inzu" | "urugo" | "nova";
  name: string;
  owner: string;
  role: string;
  place: string;
  what: string;
  plan: "Starter" | "Business" | "Custom";
  colors: [string, string];
  initials: string;
  phone: string;
  products: { name: string; price: string; emoji: string }[];
};

export const BIZ: Record<Biz["key"], Biz> = {
  inzu: {
    key: "inzu", name: "Inzu Fashion", owner: "Aline Uwase", role: "Owner", place: "Kimironko, Kigali", what: "Kitenge dresses, shirts and accessories",
    plan: "Starter", colors: ["#C2502E", "#E0A526"], initials: "IF", phone: "078 412 3390",
    products: [
      { name: "Kitenge summer dress", price: "25,000 RWF", emoji: "👗" },
      { name: "Linen shirt", price: "18,000 RWF", emoji: "👔" },
      { name: "Beaded earrings", price: "6,000 RWF", emoji: "💎" },
    ],
  },
  urugo: {
    key: "urugo", name: "Urugo Homes", owner: "Eric Mugisha", role: "Agent", place: "Kigali", what: "Houses and apartments for sale and rent",
    plan: "Business", colors: ["#1F6F54", "#D9C3A0"], initials: "UH", phone: "078 552 1104",
    products: [
      { name: "3-bedroom house, Kibagabaga", price: "120,000,000 RWF", emoji: "🏡" },
      { name: "2-bedroom apartment, Kimihurura", price: "600,000 RWF / month", emoji: "🏢" },
      { name: "Plot, Rebero", price: "35,000,000 RWF", emoji: "🌳" },
    ],
  },
  nova: {
    key: "nova", name: "Nova Phones Kigali", owner: "Patrick Habimana", role: "Owner", place: "Kigali city centre", what: "Smartphones, accessories and repairs",
    plan: "Custom", colors: ["#0A84FF", "#111111"], initials: "NP", phone: "079 803 2271",
    products: [
      { name: "Samsung Galaxy A56", price: "420,000 RWF", emoji: "📱" },
      { name: "iPhone 16", price: "1,150,000 RWF", emoji: "📱" },
      { name: "Fast charger + case", price: "15,000 RWF", emoji: "🔌" },
    ],
  },
};

export const PLAN_PRICE = {
  starter: { name: "Starter", rwf: PRICES.starter.rwf, usd: PRICES.starter.usd, texts: 60, designs: 30, users: 1 },
  business: { name: "Business", rwf: PRICES.business.rwf, usd: PRICES.business.usd, texts: 200, designs: 100, users: 3 },
};

/** The owner's side (BuPulse), receiving MoMo payments. */
export const OWNER = { momoPayCode: "184 772", momoName: "BuPulse", phone: "+250 791 954 277" };

/** Custom plan add-ons as shown in the admin (RWF / month). */
export const ADDONS = [
  { key: "autopilot", name: "Autopilot", price: 20000, needs: ["calendar", "designs"] },
  { key: "chat", name: "Website chat + WhatsApp leads", price: 10000, needs: [] },
  { key: "aiphoto", name: "AI photo designs · 300 / month", price: 20000, needs: ["designs"] },
  { key: "analytics", name: "Analytics", price: 5000, needs: ["calendar"] },
  { key: "managed", name: "Managed by BuPulse", price: 100000, needs: ["calendar"] },
];
