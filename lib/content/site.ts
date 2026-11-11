// Shared marketing content. Kept in code until the Sanity CMS is connected;
// pages import from here so the swap later only touches this folder.
import {
  Brain,
  Briefcase,
  ChartLine,
  Cog,
  Dumbbell,
  GraduationCap,
  HardHat,
  Hotel,
  House,
  Image,
  MessageCircle,
  Monitor,
  PenLine,
  Scissors,
  Smartphone,
  Sparkles,
  Stethoscope,
  Store,
  Utensils,
  Video,
  type LucideIcon,
} from "lucide-react";

export const site = {
  name: "BuPulse",
  url: "https://bupulse.com",
  tagline: "The marketing team for every small business.",
  email: "hello@bupulse.com",
};

export const navLinks = [
  { label: "Features", href: "/#features" },
  { label: "Industries", href: "/industries" },
  { label: "Pricing", href: "/pricing" },
  { label: "Done-for-you", href: "/done-for-you" },
  { label: "Blog", href: "/blog" },
];

export const footerLinks = [
  { label: "Pricing", href: "/pricing" },
  { label: "Done-for-you", href: "/done-for-you" },
  { label: "Industries", href: "/industries" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Partners", href: "/partners" },
  { label: "Blog", href: "/blog" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Refund policy", href: "/refund-policy" },
  { label: "Data deletion", href: "/data-deletion" },
];

export interface Industry {
  slug: string;
  name: string;
  icon: LucideIcon;
  summary: string;
  examples: string[];
}

export const industries: Industry[] = [
  { slug: "retail", name: "Shops & retail", icon: Store, summary: "New-arrival posts, weekly deals and stock questions answered in chat.", examples: ["New arrivals", "Weekend deals", "Back in stock"] },
  { slug: "electronics", name: "Phones & electronics", icon: Smartphone, summary: "Launch-day posts, trade-in offers and product questions handled for you.", examples: ["New model in stock", "Trade-in offer", "Repair services"] },
  { slug: "it", name: "IT & software", icon: Monitor, summary: "Service explainers, case studies and demo requests captured on your site.", examples: ["Managed IT plans", "Case studies", "Free IT check"] },
  { slug: "construction", name: "Construction", icon: HardHat, summary: "Finished-project showcases, before-and-after reels and quote requests.", examples: ["Project complete", "Before and after", "Free site visit"] },
  { slug: "schools", name: "Schools & training", icon: GraduationCap, summary: "Enrollment campaigns, event announcements and parents' questions answered.", examples: ["Enrollment open", "Open day", "Course launch"] },
  { slug: "restaurants", name: "Restaurants & cafés", icon: Utensils, summary: "Menu specials, event nights and reservation questions handled for you.", examples: ["Weekend brunch", "Live music night", "New menu"] },
  { slug: "beauty", name: "Salons & beauty", icon: Scissors, summary: "Before-and-after looks, booking reminders and seasonal offers.", examples: ["New look", "Booking slots", "Gift cards"] },
  { slug: "health", name: "Clinics & health", icon: Stethoscope, summary: "Helpful health tips, new services and appointment questions answered.", examples: ["New service", "Health tips", "Book a check-up"] },
  { slug: "machinery", name: "Machinery & equipment", icon: Cog, summary: "Equipment showcases, rental offers and quote requests.", examples: ["New stock", "Rental offers", "Service plans"] },
  { slug: "real-estate", name: "Real estate", icon: House, summary: "Listing posts, open houses and viewing requests.", examples: ["Just listed", "Open house", "Sold"] },
  { slug: "hospitality", name: "Hotels & travel", icon: Hotel, summary: "Seasonal packages, guest stories and booking questions.", examples: ["Summer package", "Guest reviews", "Last-minute deals"] },
  { slug: "fitness", name: "Gyms & fitness", icon: Dumbbell, summary: "Class launches, member wins and trial-pass offers.", examples: ["New class", "Member spotlight", "Free trial pass"] },
  { slug: "services", name: "Professional services", icon: Briefcase, summary: "Expert tips, client results and consultation requests.", examples: ["Free consultation", "Client results", "Tips and guides"] },
];

export interface Feature {
  title: string;
  text: string;
  icon: LucideIcon;
  soon?: boolean;
  /** A short badge saying how the feature comes (e.g. not in every plan). */
  note?: string;
  /** Takes the whole row of the grid (the last card, so the grid never ends on a lone card). */
  wide?: boolean;
}

export const features: Feature[] = [
  { title: "Knows your business", icon: Brain, text: "Teach it once: products, prices, hours, service area and tone. Everything it writes uses that knowledge." },
  { title: "Content generator", icon: PenLine, text: "Social captions with hashtags, short video scripts and ad headlines in your brand voice." },
  { title: "Post everywhere", icon: ChartLine, text: "Connect Instagram, Facebook, TikTok, LinkedIn and YouTube. Plan, schedule and publish from one calendar." },
  { title: "Lead-capturing chat", icon: MessageCircle, text: "One line of code on your website. It answers visitors and saves their name, phone or email and what they need." },
  { title: "Brand designs", icon: Image, text: "Ready-to-post graphics with your logo and colors. Or just describe the image you want." },
  // Slideshow videos and voice-overs are built (lib/features.ts "video", "voice") in the plans that include them; AI
  // presenter ads are made on request (the home page's AI videos section says how).
  { title: "Videos for Reels and TikTok", icon: Video, text: "Short vertical videos made from your posts and photos, with captions and music, and AI presenter ads in the Business plans.", note: "Not in every plan" },
  // Not in the standard plans: it comes with a custom plan or as an add-on (lib/offers/shared.ts ADDONS), so the card says so.
  { title: "Autopilot", icon: Sparkles, text: "AI plans your week of posts: new arrivals, offers and tips, each written for every network with a design. You approve them all with one tap and they go out on schedule. Comes with a custom plan, or as an add-on to yours.", note: "Custom plan or add-on", wide: true },
];

/** Answers may contain {trialDays}; fill it with fillFaq() where they are shown (the trial length is an admin setting). */
export const faqs = [
  { q: "Does BuPulse work for my type of business?", a: "Yes. Shops, schools, construction, IT, restaurants, salons, clinics and more. You tell BuPulse what you do, and it writes for your customers." },
  { q: "How do I get started?", a: "Sign up, tell BuPulse about your business, then choose the plan you want to try: your {trialDays}-day free trial starts right away, with a limited number of generations, so you can see real results before you pay. No card needed for the trial." },
  { q: "Do I need marketing experience?", a: "No. If you can describe what you sell, BuPulse does the rest. You review and post." },
  { q: "Are the people in your videos real?", a: "In our AI presenter videos, no. The presenter is made with AI: they look and sound like a real person, but nobody was filmed. That is what makes a fresh video ad quick to make, with no camera, studio or actor to book." },
  { q: "Can the videos speak Kinyarwanda?", a: "AI voices are not good enough in Kinyarwanda yet, so we don’t use them. Kinyarwanda videos use music with Kinyarwanda captions, and talking skits voiced by a real Rwandan voice are coming soon. AI presenters speak English." },
  { q: "Which social networks can I post to?", a: "Instagram, Facebook, TikTok, LinkedIn and YouTube. You connect your own accounts with a normal login." },
  { q: "Do I have to approve every post?", a: "At first, yes: every daily post waits for your OK, and one tap approves it. When you trust it, switch on automatic approval in Post settings and BuPulse posts on its own at the best time of day." },
  { q: "How does the chat widget get on my website?", a: "You paste one line of code into your site. It answers visitors from the information you gave BuPulse, saves their name and phone number or email in your Leads list and emails you about each new lead." },
  { q: "How do I pay?", a: "Monthly, or yearly with a discount. In Rwanda you pay by MTN MoMo, Airtel Money or card; elsewhere by card. You can cancel any time, and your plan stays active until the end of the period you paid for." },
  { q: "Will it sound like my brand?", a: "Yes. You set your brand voice once during setup, and everything is written in it." },
  { q: "What is done-for-you?", a: "If you would rather not do it yourself, our team runs your social content and lead capture with BuPulse for a monthly fee." },
];

// Testimonials: none yet. The home page section (components/marketing/home/testimonials.tsx, removed 12 October 2026,
// in git history) comes back once pilot clients have agreed to be quoted; until then nothing made up is shown.

// Plans, prices and the trial now come from the database (lib/plan-catalog.ts, managed at /admin/plans).

/** "How do I get started?" for Rwanda visitors, who ask for a free quote instead of a trial (lib/quote/cta.ts). */
export const QUOTE_GET_STARTED_ANSWER =
  "Ask for a free quote: tell us your name, phone number and business in a minute. We call you back shortly, suggest the plan that fits, and set up your account with you. You pay monthly or yearly by Mobile Money or card.";

/** The FAQ with the live trial length filled in; in "quote" mode, getting started is the free quote. */
export function fillFaq<T extends { q: string; a: string }>(items: T[], trialDays: number, mode: "quote" | "trial" = "trial"): T[] {
  return items.map((f) => ({ ...f, a: mode === "quote" && /^how do i get started/i.test(f.q) ? QUOTE_GET_STARTED_ANSWER : f.a.replaceAll("{trialDays}", String(trialDays)) }));
}
