// Template metadata only: safe to import from client components (no rendering code here).
export type TemplateId = "new-arrival" | "offer" | "event" | "just-listed" | "project-done" | "quote" | "announcement";

type FieldHint = { label: string; placeholder: string };

export type TemplateInfo = {
  id: TemplateId;
  name: string;
  description: string;
  /** Label above the headline when the user gives none; "" means none. */
  defaultKicker: string;
  fields: { headline: FieldHint; subline: FieldHint; chip: FieldHint };
  /** Project types (Project.type) this template suits, best first. */
  suits: string[];
};

export const TEMPLATES: TemplateInfo[] = [
  {
    id: "new-arrival",
    name: "New arrival",
    description: "Full-bleed photo with a bold headline and a price tag. For anything that is new in.",
    defaultKicker: "New arrival",
    fields: {
      headline: { label: "Headline", placeholder: "The all-new Aero Sneaker" },
      subline: { label: "Subline", placeholder: "Light, bold and ready to wear" },
      chip: { label: "Price", placeholder: "From $89" },
    },
    suits: ["product", "offer"],
  },
  {
    id: "offer",
    name: "Offer",
    description: "Brand colours with a round price or discount badge. For sales, deals and limited offers.",
    defaultKicker: "Special offer",
    fields: {
      headline: { label: "Headline", placeholder: "Weekend sale on everything" },
      subline: { label: "Details", placeholder: "Until Sunday, while stocks last" },
      chip: { label: "Badge", placeholder: "20% off" },
    },
    suits: ["offer", "product", "service"],
  },
  {
    id: "event",
    name: "Event",
    description: "Invitation with a large date block. For openings, workshops, parties and meetups.",
    defaultKicker: "You are invited",
    fields: {
      headline: { label: "Event name", placeholder: "Grand opening party" },
      subline: { label: "Place and time", placeholder: "12 Main Street · 6 pm" },
      chip: { label: "Date", placeholder: "Sat 14 June" },
    },
    suits: ["event"],
  },
  {
    id: "just-listed",
    name: "Just listed",
    description: "Framed photo with the address or title and the price. For listings and new availability.",
    defaultKicker: "Just listed",
    fields: {
      headline: { label: "Title or address", placeholder: "14 Harbour View, Seaside" },
      subline: { label: "Details", placeholder: "3 bedrooms · 2 baths · garden" },
      chip: { label: "Price", placeholder: "$485,000" },
    },
    suits: ["listing", "service", "product"],
  },
  {
    id: "project-done",
    name: "Project done",
    description: "Showcase of finished work with the photo front and centre.",
    defaultKicker: "Project done",
    fields: {
      headline: { label: "Headline", placeholder: "Kitchen renovation, finished" },
      subline: { label: "Details", placeholder: "New cabinets, stone worktop, lighting" },
      chip: { label: "Call to action", placeholder: "Get a free quote" },
    },
    suits: ["project", "service"],
  },
  {
    id: "quote",
    name: "Quote",
    description: "A customer review or saying in large type. The photo, if any, becomes a small portrait.",
    defaultKicker: "",
    fields: {
      headline: { label: "Quote", placeholder: "Best service we have ever had." },
      subline: { label: "Who said it", placeholder: "Amina, customer" },
      chip: { label: "Not used", placeholder: "" },
    },
    suits: ["service", "product", "project", "listing", "event", "offer"],
  },
  {
    id: "announcement",
    name: "Announcement",
    description: "Big, plain message on your brand colours, with an optional tinted photo behind it.",
    defaultKicker: "Announcement",
    fields: {
      headline: { label: "Message", placeholder: "We are open on Sundays now" },
      subline: { label: "Details", placeholder: "Come by between 10 and 4" },
      chip: { label: "Call to action", placeholder: "Visit us today" },
    },
    suits: ["service", "event", "project", "offer", "product", "listing"],
  },
];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && TEMPLATES.some((t) => t.id === value);
}

/** Template ids that suit a project type, best match first (all templates follow, so none is hidden). */
export function templatesForProjectType(type: string): TemplateId[] {
  const suited = TEMPLATES.filter((t) => t.suits.includes(type)).sort((a, b) => a.suits.indexOf(type) - b.suits.indexOf(type));
  const rest = TEMPLATES.filter((t) => !suited.includes(t));
  return [...suited, ...rest].map((t) => t.id);
}
