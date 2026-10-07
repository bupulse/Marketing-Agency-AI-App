// Default small labels ("kickers") above template headlines, in the business's content language.
// Languages not listed fall back to English: Hindi, Chinese and Japanese have no font we can draw,
// and Arabic is left out because Satori does not shape or mirror right-to-left text reliably, so
// translated labels would render broken. (User-typed Arabic text still draws, see DESIGNS.md.)
import type { TemplateId } from "./templates/registry";

type Labels = Record<TemplateId, string>;

const EN: Labels = {
  "new-arrival": "New arrival",
  offer: "Special offer",
  event: "You are invited",
  "just-listed": "Just listed",
  "project-done": "Project done",
  quote: "",
  announcement: "Announcement",
};

const LABELS: Record<string, Labels> = {
  English: EN,
  French: { ...EN, "new-arrival": "Nouveauté", offer: "Offre spéciale", event: "Vous êtes invités", "just-listed": "Nouvellement en vente", "project-done": "Projet terminé", announcement: "Annonce" },
  Spanish: { ...EN, "new-arrival": "Novedad", offer: "Oferta especial", event: "Estás invitado", "just-listed": "Recién publicado", "project-done": "Proyecto terminado", announcement: "Anuncio" },
  Portuguese: { ...EN, "new-arrival": "Novidade", offer: "Oferta especial", event: "Você está convidado", "just-listed": "Acabou de chegar", "project-done": "Projeto concluído", announcement: "Aviso" },
  German: { ...EN, "new-arrival": "Neu eingetroffen", offer: "Sonderangebot", event: "Sie sind eingeladen", "just-listed": "Neu im Angebot", "project-done": "Projekt abgeschlossen", announcement: "Ankündigung" },
  Italian: { ...EN, "new-arrival": "Novità", offer: "Offerta speciale", event: "Sei invitato", "just-listed": "Appena pubblicato", "project-done": "Progetto completato", announcement: "Annuncio" },
  Dutch: { ...EN, "new-arrival": "Nieuw binnen", offer: "Speciale aanbieding", event: "Je bent uitgenodigd", "just-listed": "Net te koop", "project-done": "Project afgerond", announcement: "Aankondiging" },
  Swahili: { ...EN, "new-arrival": "Bidhaa mpya", offer: "Ofa maalum", event: "Umekaribishwa", "just-listed": "Imetangazwa sasa", "project-done": "Kazi imekamilika", announcement: "Tangazo" },
  Kinyarwanda: { ...EN, "new-arrival": "Igishya", offer: "Igabanyirizwa", event: "Murakaza neza", "just-listed": "Bishya ku isoko", "project-done": "Umushinga urangiye", announcement: "Itangazo" },
  Turkish: { ...EN, "new-arrival": "Yeni geldi", offer: "Özel teklif", event: "Davetlisiniz", "just-listed": "Yeni ilan", "project-done": "Proje tamamlandı", announcement: "Duyuru" },
  Indonesian: { ...EN, "new-arrival": "Baru tiba", offer: "Penawaran spesial", event: "Anda diundang", "just-listed": "Baru dipasarkan", "project-done": "Proyek selesai", announcement: "Pengumuman" },
};

/** The default kicker for a template in a language; English when the language is not covered. */
export function defaultKicker(template: TemplateId, language?: string | null): string {
  return (LABELS[language ?? "English"] ?? EN)[template];
}
