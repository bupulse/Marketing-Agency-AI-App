// The places the location searches offer (docs/CREATOR_CAMPAIGN_WIZARD.md): Rwanda's provinces and 30 districts first,
// then the region's big cities. Pure. A typed place that is not listed is kept as typed.

const RWANDA: Record<string, string[]> = {
  Kigali: ["Gasabo", "Kicukiro", "Nyarugenge"],
  "Northern Province": ["Burera", "Gakenke", "Gicumbi", "Musanze", "Rulindo"],
  "Southern Province": ["Gisagara", "Huye", "Kamonyi", "Muhanga", "Nyamagabe", "Nyanza", "Nyaruguru", "Ruhango"],
  "Eastern Province": ["Bugesera", "Gatsibo", "Kayonza", "Kirehe", "Ngoma", "Nyagatare", "Rwamagana"],
  "Western Province": ["Karongi", "Ngororero", "Nyabihu", "Nyamasheke", "Rubavu", "Rusizi", "Rutsiro"],
};

const REGION = ["Nairobi, Kenya", "Kampala, Uganda", "Dar es Salaam, Tanzania", "Bujumbura, Burundi", "Goma, DR Congo"];

/** "Kigali", "Kigali, Gasabo", ..., "Western Province, Rutsiro", then the region's cities. */
export const PLACES: string[] = [...Object.entries(RWANDA).flatMap(([area, districts]) => [area, ...districts.map((d) => `${area}, ${d}`)]), ...REGION];

/** The places matching what was typed (every word must appear), at most `limit`. */
export function searchPlaces(query: string, limit = 8): string[] {
  const words = query.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return PLACES.slice(0, limit);
  return PLACES.filter((p) => words.every((w) => p.toLowerCase().includes(w))).slice(0, limit);
}
