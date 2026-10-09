// The demo accounts (all fictional). Everything created for the videos hangs off these emails.
export const PASSWORD = "Demo-Pulse-Kigali-2026!";

export const ACCOUNTS = {
  inzu: {
    email: "demo+inzu@bupulse.com",
    plan: "STANDARD",
    meta: { organisation_name: "Inzu Fashion", ceo_name: "Aline Uwase", industry: "Shops & retail", country: "Rwanda", phone: "+250 788 412 305", website: "" },
    offer: {
      description:
        "A fashion boutique in Kimironko, Kigali. We sell kitenge dresses, African print shirts, head wraps and accessories, with new pieces arriving every week. Tailoring and alterations on request.",
      audience: "Women and men in Kigali aged 20 to 45 who love colourful African print fashion for work, weddings and weekends.",
    },
    tone: "friendly",
    colors: ["#C2502E", "#E0A526"],
    knowledge: {
      hours: "Mon to Sat, 9am to 8pm. Sunday 12pm to 6pm.",
      area: "Kimironko, Kigali, near Kimironko Market. Delivery anywhere in Kigali.",
      contact: "Call or WhatsApp +250 788 412 305",
      faqs: [{ question: "Do you deliver?", answer: "Yes, anywhere in Kigali within 24 hours for 2,000 RWF." }],
    },
  },
  urugo: {
    email: "demo+urugo@bupulse.com",
    plan: "PRO",
    meta: { organisation_name: "Urugo Homes", ceo_name: "Eric Mugisha", industry: "Real estate", country: "Rwanda", phone: "+250 788 630 918", website: "https://urugohomes.rw" },
    offer: {
      description:
        "A real estate agency in Kigali. We sell and rent houses, apartments and plots in Kibagabaga, Kimihurura, Nyarutarama, Kacyiru and Rebero, and help buyers with viewings, paperwork and mortgages.",
      audience: "Families, young professionals, diaspora buyers and expatriates looking to buy or rent a home in Kigali.",
    },
    tone: "professional",
    colors: ["#1F6F54", "#D9C3A0"],
    knowledge: {
      hours: "Mon to Fri, 8am to 6pm. Saturday 9am to 2pm. Viewings by appointment.",
      area: "All of Kigali: Kibagabaga, Kimihurura, Nyarutarama, Kacyiru, Rebero, Gacuriro.",
      contact: "Call or WhatsApp +250 788 630 918",
      faqs: [{ question: "Do you charge buyers a fee?", answer: "No. Our commission is paid by the seller or landlord." }],
    },
    team: [
      { email: "demo+urugo-claudine@bupulse.com", name: "Claudine Ingabire", role: "ADMIN" },
      { email: "demo+urugo-jean@bupulse.com", name: "Jean Bosco Nkurunziza", role: "MEMBER" },
    ],
  },
  nova: {
    email: "demo+nova@bupulse.com",
    plan: "PRO",
    meta: { organisation_name: "Nova Phones Kigali", ceo_name: "Patrick Habimana", industry: "Phones & electronics", country: "Rwanda", phone: "+250 788 275 641", website: "https://novaphones.rw" },
    offer: {
      description:
        "A phone and accessories shop in downtown Kigali. We sell new Samsung, iPhone, Tecno and Infinix phones, fast chargers, cases, earbuds and power banks, with a 12-month warranty, trade-ins and same-day screen repairs.",
      audience: "Students, young professionals and small business owners in Kigali who want a genuine phone at a fair price, with warranty and good after-sales service.",
    },
    tone: "bold",
    colors: ["#0A84FF", "#0B0B0F"],
    knowledge: {
      hours: "Mon to Sat, 8am to 9pm. Sunday 10am to 6pm.",
      area: "Downtown Kigali, Kigali Heights ground floor. Free delivery in Kigali for phones.",
      contact: "Call or WhatsApp +250 788 275 641",
      faqs: [
        { question: "How much is the Samsung Galaxy A56?", answer: "420,000 RWF for the 8GB/256GB model, in stock in black, light blue and pink. 12-month warranty included." },
        { question: "How much is the iPhone 16?", answer: "1,150,000 RWF for 128GB. 1,290,000 RWF for 256GB. Genuine, sealed, 12-month warranty." },
        { question: "Do you accept trade-ins?", answer: "Yes. Bring your old phone and we value it in 10 minutes; the value comes off your new phone." },
        { question: "Can I pay in instalments?", answer: "Yes, with MoMo instalments over 3 months for phones above 300,000 RWF, with a 30% deposit." },
        { question: "Do you sell chargers and cases?", answer: "Yes: 25W and 45W fast chargers from 15,000 RWF, cases from 5,000 RWF, screen protectors fitted free." },
      ],
    },
  },
  onboard: {
    email: "demo+onboard@bupulse.com",
    plan: null,
    meta: { organisation_name: "Inzu Fashion", ceo_name: "Aline Uwase", industry: "Shops & retail", country: "Rwanda", phone: "+250 788 412 305", website: "" },
  },
};

export const ALL_DEMO_EMAILS = [
  ...Object.values(ACCOUNTS).map((a) => a.email),
  ...ACCOUNTS.urugo.team.map((t) => t.email),
];
