import "server-only";
// Offline lat/lng -> ISO country: a point-in-polygon lookup over the border data bundled in @rapideditor/country-coder
// (ISC, about 690 KB, loaded only by server code). No network call, no outside service, nothing leaves our server.
// Land points only: open sea (and Antarctica) answer null. Borders are generalised, so a point within a few hundred
// metres of a border can fall on the wrong side; for choosing a pricing region that is fine.
import { iso1A2Code } from "@rapideditor/country-coder";

export function builtinCountryAt(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const code = iso1A2Code([lng, lat]); // GeoJSON order: [lng, lat]
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
