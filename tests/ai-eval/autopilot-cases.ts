import { holidaysBetween } from "@/lib/autopilot/calendar";
import { EMPTY_PROFILE } from "@/lib/autopilot/learning";
import type { PlanInput } from "@/lib/autopilot/planner";
import { industryTags } from "@/lib/autopilot/playbook";
import { DEFAULT_CONFIG } from "@/lib/autopilot/settings";
import { nextWeekStart, weekDates } from "@/lib/autopilot/timezone";
import type { WriterBrand } from "@/lib/autopilot/writer";
import type { Network } from "@/lib/social/types";

// Five varied businesses for the Autopilot quality check (tests/ai-eval/autopilot.test.ts).
export interface AutopilotEvalCase {
  id: string;
  brand: WriterBrand;
  timezone: string;
  networks: Network[];
  postsPerWeek: number;
  projects: PlanInput["projects"];
  faqs: PlanInput["faqs"];
}

const created = new Date("2026-10-01T00:00:00Z");
const project = (id: string, type: string, title: string, over: Partial<PlanInput["projects"][number]> = {}): PlanInput["projects"][number] => ({
  id,
  type,
  title,
  price: null,
  features: [],
  photoPaths: [],
  createdAt: created,
  postedCount: 0,
  lastPostedAt: null,
  ...over,
});

export const autopilotCases: AutopilotEvalCase[] = [
  {
    id: "phone-shop-en",
    brand: { businessName: "TechHub Kigali", industry: "Phone store", description: "New and refurbished smartphones and accessories", audience: "Students and young professionals", tone: "bold", contentLanguage: "English", country: "Rwanda", knowledge: { hours: "Mon-Sat 8:00-19:00", area: "Kigali", contact: "+250 788 111 222" }, ownerName: "Eric" },
    timezone: "Africa/Kigali",
    networks: ["instagram", "facebook", "linkedin", "tiktok"],
    postsPerWeek: 4,
    projects: [project("p1", "product", "Galaxy A55 128GB", { price: "420,000 RWF", features: ["6.6-inch display", "Dual SIM", "1-year warranty"] }), project("p2", "offer", "Trade-in week", { price: "Up to 50,000 RWF off", features: ["Bring your old phone"] })],
    faqs: [{ question: "Do you repair screens?", answer: "Yes, we repair screens while you wait for most popular models." }],
  },
  {
    id: "school-fr",
    brand: { businessName: "Lycée Les Cèdres", industry: "School", description: "Private bilingual primary and secondary school", audience: "Parents of children aged 5 to 17", tone: "caring", contentLanguage: "French", country: "France", knowledge: { contact: "admissions@lescedres.example" } },
    timezone: "Europe/Paris",
    networks: ["instagram", "facebook", "linkedin"],
    postsPerWeek: 4,
    projects: [project("p1", "event", "Journée portes ouvertes", { features: ["Visite des classes", "Rencontre avec les enseignants", "Inscriptions ouvertes"], notes: "Samedi 14 mars, de 9h à 13h" })],
    faqs: [{ question: "Les inscriptions sont-elles ouvertes ?", answer: "Oui, les inscriptions sont ouvertes toute l'année selon les places disponibles." }],
  },
  {
    id: "builder-en",
    brand: { businessName: "Imara Builders", industry: "Construction", description: "Residential and commercial building contractor", audience: "Homeowners and property developers", tone: "professional", contentLanguage: "English", country: "Kenya" },
    timezone: "Africa/Nairobi",
    networks: ["linkedin", "instagram", "youtube"],
    postsPerWeek: 4,
    projects: [project("p1", "project", "Completed family home in Nyarutarama", { features: ["4 bedrooms", "Solar water heating", "Delivered on schedule"], photoPaths: ["u/projects/1.jpg", "u/projects/2.jpg"] })],
    faqs: [],
  },
  {
    id: "salon-es",
    brand: { businessName: "Glow Studio", industry: "Beauty salon", description: "Hair, nails and skincare", audience: "Women who want a relaxing, polished look", tone: "playful", contentLanguage: "Spanish", country: "Spain" },
    timezone: "Europe/Madrid",
    networks: ["instagram", "tiktok", "facebook"],
    postsPerWeek: 4,
    projects: [project("p1", "offer", "Pack novia: peinado y maquillaje", { price: "120 €", features: ["Prueba previa incluida", "Servicio a domicilio"] })],
    faqs: [],
  },
  {
    id: "clinic-sw",
    brand: { businessName: "Afya Bora Clinic", industry: "Clinic", description: "Family health clinic with general practice and dental care", audience: "Families in Dar es Salaam", tone: "caring", contentLanguage: "Swahili", country: "Tanzania", knowledge: { hours: "Jumatatu hadi Jumamosi, saa 2 asubuhi hadi saa 12 jioni" } },
    timezone: "Africa/Dar_es_Salaam",
    networks: ["facebook", "instagram", "linkedin"],
    postsPerWeek: 4,
    projects: [project("p1", "service", "Uchunguzi wa afya kwa familia", { features: ["Vipimo vya shinikizo la damu", "Ushauri wa lishe"] })],
    faqs: [{ question: "Je, mnapokea bima ya afya?", answer: "Ndiyo, tunapokea bima kuu za afya. Tuulize kwa maelezo zaidi." }],
  },
];

/** The planner's input for a case, for the week after `now`. */
export function planInputFor(c: AutopilotEvalCase, now = new Date("2026-10-09T08:00:00Z")): PlanInput {
  const weekStart = nextWeekStart(now, c.timezone);
  const dates = weekDates(weekStart, c.timezone);
  return {
    businessId: `eval-${c.id}`,
    weekStart,
    timeZone: c.timezone,
    country: c.brand.country ?? null,
    industryTags: industryTags(c.brand.industry),
    config: { ...DEFAULT_CONFIG, enabled: true, postsPerWeek: c.postsPerWeek },
    connections: c.networks.map((network) => ({ id: `c-${network}`, network })),
    projects: c.projects,
    faqs: c.faqs,
    hasHours: !!c.brand.knowledge?.hours,
    holidays: holidaysBetween(c.brand.country, dates[0], dates[6]),
    photos: [],
    existing: [],
    recentIdeas: new Map(),
    profile: EMPTY_PROFILE,
    now,
  };
}
