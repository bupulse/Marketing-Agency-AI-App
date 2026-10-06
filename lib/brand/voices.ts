import { industries } from "@/lib/content/site";

// Brand voice presets. The id is stored in Business.tone and the guide is given to
// the AI with every generation. Samples are written from templates (no AI cost).

export type VoiceId = "friendly" | "professional" | "bold" | "playful" | "luxury" | "caring";

export type Voice = {
  id: VoiceId;
  label: string;
  description: string;
  /** Instructions for the AI writer. */
  guide: string;
  sample: (s: { businessName: string; topic: string }) => string;
};

export const voices: Voice[] = [
  {
    id: "friendly",
    label: "Friendly",
    description: "Warm and welcoming, like talking to a neighbour.",
    guide: "Warm, welcoming and conversational. Short sentences, simple words, one or two emojis at most.",
    sample: ({ businessName, topic }) =>
      `${topic} at ${businessName}! 😊 Pop in and say hi. We'd love to help you find just what you need.`,
  },
  {
    id: "professional",
    label: "Professional",
    description: "Clear, confident and trustworthy.",
    guide: "Clear, confident and precise. No slang, no emojis. Lead with the benefit and end with a clear next step.",
    sample: ({ businessName, topic }) =>
      `${topic}. ${businessName} delivers reliable quality and service you can count on. Contact us today to learn more.`,
  },
  {
    id: "bold",
    label: "Bold",
    description: "Energetic and direct. Gets attention fast.",
    guide: "Energetic, punchy and direct. Strong verbs, short lines, a confident call to action.",
    sample: ({ businessName, topic }) =>
      `${topic.toUpperCase()}. 🔥 ${businessName} just raised the bar. Don't wait. Come see it for yourself.`,
  },
  {
    id: "playful",
    label: "Playful",
    description: "Fun, light and full of personality.",
    guide: "Light-hearted and witty, with gentle humour and a few emojis. Never sarcastic about the customer.",
    sample: ({ businessName, topic }) =>
      `Plot twist: ${topic.toLowerCase()} 🎉 ${businessName} has been busy, and honestly? We're a little proud. Come find out why.`,
  },
  {
    id: "luxury",
    label: "Luxury",
    description: "Elegant, calm and premium.",
    guide: "Elegant, calm and refined. Few words, rich detail, no exclamation marks or emojis.",
    sample: ({ businessName, topic }) =>
      `${topic}. Thoughtfully chosen, beautifully delivered. Discover the ${businessName} experience.`,
  },
  {
    id: "caring",
    label: "Caring",
    description: "Supportive and reassuring. Puts people first.",
    guide: "Supportive, patient and reassuring. Focus on the customer's needs and how you help them.",
    sample: ({ businessName, topic }) =>
      `${topic}. At ${businessName}, we take the time to understand what you need, and we're here for you every step of the way.`,
  },
];

export function getVoice(id: string | null | undefined): Voice | undefined {
  return voices.find((v) => v.id === id);
}

/** A sample topic for the business's industry, e.g. "New arrivals" for shops. */
export function sampleTopic(industry: string | null | undefined): string {
  return industries.find((i) => i.name === industry)?.examples[0] ?? "Something new";
}
