import type { BrandContext, PromotionInput } from "@/lib/ai/marketing";

// Twenty varied example businesses for the content quality check (tests/ai-eval/run.test.ts).
export interface EvalCase {
  id: string;
  brand: BrandContext;
  project: PromotionInput;
}

export const evalCases: EvalCase[] = [
  {
    id: "phone-shop",
    brand: { businessName: "TechHub Kigali", industry: "Phone store", description: "New and refurbished smartphones and accessories", audience: "Students and young professionals", tone: "bold", contentLanguage: "English", knowledge: { hours: "Mon-Sat 8:00-19:00", area: "Kigali", contact: "+250 788 111 222" } },
    project: { type: "product", title: "Galaxy A55 128GB", price: "420,000 RWF", features: ["6.6-inch display", "Dual SIM", "1-year warranty"] },
  },
  {
    id: "school",
    brand: { businessName: "Lycée Les Cèdres", industry: "School", description: "Private bilingual primary and secondary school", audience: "Parents of children aged 5 to 17", tone: "caring", contentLanguage: "French", knowledge: { contact: "admissions@lescedres.example" } },
    project: { type: "event", title: "Journée portes ouvertes", features: ["Visite des classes", "Rencontre avec les enseignants", "Inscriptions ouvertes"], extraDetails: "Samedi 14 mars, de 9h à 13h" },
  },
  {
    id: "construction",
    brand: { businessName: "Imara Builders", industry: "Construction", description: "Residential and commercial building contractor", audience: "Homeowners and property developers", tone: "professional", contentLanguage: "English" },
    project: { type: "project", title: "Completed family home in Nyarutarama", features: ["4 bedrooms", "Solar water heating", "Delivered on schedule"] },
  },
  {
    id: "salon",
    brand: { businessName: "Glow Studio", industry: "Beauty salon", description: "Hair, nails and skincare", audience: "Women who want a relaxing, polished look", tone: "playful", contentLanguage: "Spanish" },
    project: { type: "offer", title: "Pack novia: peinado y maquillaje", price: "120 €", features: ["Prueba previa incluida", "Servicio a domicilio"] },
  },
  {
    id: "clinic",
    brand: { businessName: "Afya Bora Clinic", industry: "Clinic", description: "Family health clinic with general practice and dental care", audience: "Families in Dar es Salaam", tone: "caring", contentLanguage: "Swahili", knowledge: { hours: "Jumatatu hadi Jumamosi, saa 2 asubuhi hadi saa 12 jioni" } },
    project: { type: "service", title: "Uchunguzi wa afya kwa familia", features: ["Vipimo vya shinikizo la damu", "Ushauri wa lishe"] },
  },
  {
    id: "restaurant",
    brand: { businessName: "Urugo Kitchen", industry: "Restaurant", description: "Rwandan home-style cooking", audience: "Locals and visitors", tone: "friendly", contentLanguage: "Kinyarwanda" },
    project: { type: "product", title: "Isombe n'ibishyimbo", price: "3,500 RWF", features: ["Bitetse n'umuriro w'inkwi", "Bitangwa bishyushye"] },
  },
  {
    id: "it-company",
    brand: { businessName: "NovaStack", industry: "IT services", description: "Managed IT support and cloud setup for small companies", audience: "Business owners with 5 to 50 staff", tone: "professional", contentLanguage: "English", website: "https://novastack.example" },
    project: { type: "service", title: "Managed IT support plan", price: "From $99 per month", features: ["Same-day response", "Backup monitoring", "Staff onboarding"] },
  },
  {
    id: "real-estate",
    brand: { businessName: "Horizon Realty", industry: "Real estate", description: "Homes for sale and rent", audience: "Families and investors", tone: "luxury", contentLanguage: "English" },
    project: { type: "listing", title: "3-bedroom villa in Kibagabaga", price: "$185,000", features: ["Garden and garage", "Quiet gated street", "Title deed ready"] },
  },
  {
    id: "gym",
    brand: { businessName: "Iron Pulse Fitness", industry: "Gym", description: "Strength and conditioning gym with group classes", audience: "Adults who want to get fitter", tone: "bold", contentLanguage: "French" },
    project: { type: "offer", title: "Abonnement trimestriel", price: "-20 %", features: ["Accès illimité aux cours collectifs", "Évaluation physique offerte"] },
  },
  {
    id: "hotel",
    brand: { businessName: "Lakeview Lodge", industry: "Hotel", description: "Boutique lakeside hotel with a restaurant and spa", audience: "Couples and weekend travellers", tone: "luxury", contentLanguage: "English", knowledge: { area: "Lake Kivu, Rubavu" } },
    project: { type: "offer", title: "Weekend getaway package", price: "$250 for two", features: ["Breakfast included", "Sunset boat ride"] },
  },
  {
    id: "machinery",
    brand: { businessName: "AgroMach Supplies", industry: "Machinery", description: "Tractors, irrigation pumps and farm equipment", audience: "Farmers and cooperatives", tone: "professional", contentLanguage: "English" },
    project: { type: "product", title: "Diesel irrigation pump", price: "$640", features: ["Delivers 30 cubic metres per hour", "Spare parts in stock", "Training on delivery"] },
  },
  {
    id: "ngo",
    brand: { businessName: "Hope Bridge Foundation", industry: "NGO", description: "Funds school fees and meals for children in rural communities", audience: "Donors and volunteers", tone: "caring", contentLanguage: "English" },
    project: { type: "project", title: "School meals campaign", features: ["Every donation feeds a child at school", "Monthly updates to donors"] },
  },
  {
    id: "photographer",
    brand: { businessName: "Lumière Photos", industry: "Photography", description: "Wedding and portrait photographer", audience: "Couples and families", tone: "luxury", contentLanguage: "French" },
    project: { type: "service", title: "Séance photo de couple", price: "150 €", features: ["Une heure de séance", "30 photos retouchées", "Galerie en ligne privée"] },
  },
  {
    id: "bakery",
    brand: { businessName: "Mama Amani Bakery", industry: "Bakery", description: "Fresh bread, cakes and pastries baked daily", audience: "Neighbourhood families", tone: "friendly", contentLanguage: "Swahili", knowledge: { hours: "Kila siku saa 12 asubuhi hadi saa 2 usiku" } },
    project: { type: "product", title: "Keki ya siku ya kuzaliwa", price: "25,000 TZS", features: ["Inaoka siku hiyo hiyo", "Inaweza kuandikwa jina"] },
  },
  {
    id: "law-firm",
    brand: { businessName: "Mwangi & Partners Advocates", industry: "Law firm", description: "Business, property and family law", audience: "Small business owners and families", tone: "professional", contentLanguage: "English" },
    project: { type: "service", title: "Free first consultation for new businesses", features: ["Company registration guidance", "Contract review"] },
  },
  {
    id: "car-repair",
    brand: { businessName: "Garage Express", industry: "Car repair", description: "Mechanical repair and servicing for all makes", audience: "Drivers and small fleets", tone: "friendly", contentLanguage: "Spanish" },
    project: { type: "offer", title: "Revisión completa antes del viaje", price: "49 €", features: ["Frenos, aceite y neumáticos", "Resultado el mismo día"] },
  },
  {
    id: "fashion",
    brand: { businessName: "Kitenge Kollective", industry: "Fashion", description: "Modern African-print clothing made by local tailors", audience: "Style-conscious women and men", tone: "playful", contentLanguage: "English" },
    project: { type: "product", title: "Sunset wrap dress", price: "$55", features: ["Hand-finished seams", "Sizes S to XL", "Made to order in 5 days"] },
  },
  {
    id: "farm-produce",
    brand: { businessName: "Ubuhinzi Fresh", industry: "Farm produce", description: "Fresh vegetables and fruit delivered from our farm", audience: "Households and restaurants", tone: "friendly", contentLanguage: "Kinyarwanda" },
    project: { type: "product", title: "Agasanduku k'imboga", price: "8,000 RWF", features: ["Imboga zitoranywa uwo munsi", "Tugeza aho utuye"] },
  },
  {
    id: "events-venue",
    brand: { businessName: "Ubwiza Gardens", industry: "Events venue", description: "Outdoor garden venue for weddings and corporate events", audience: "Couples and event planners", tone: "luxury", contentLanguage: "English" },
    project: { type: "listing", title: "Garden wedding venue", features: ["Seats up to 300 guests", "On-site parking", "Catering partners available"] },
  },
  {
    id: "tutoring",
    brand: { businessName: "BrightPath Tutors", industry: "Tutoring", description: "Maths and science tutoring for secondary students", audience: "Parents and students", tone: "caring", contentLanguage: "English" },
    project: { type: "service", title: "Exam preparation course", price: "$30 per month", features: ["Small groups", "Weekly practice tests", "Progress reports to parents"] },
  },
];
