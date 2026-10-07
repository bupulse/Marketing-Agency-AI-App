import { describe, expect, it } from "vitest";
import { countryCode, easterSunday, holidaysBetween, holidaysForYear } from "@/lib/autopilot/calendar";

const find = (country: string | null, year: number, id: string) => holidaysForYear(country, year).filter((h) => h.id === id).map((h) => h.date);

describe("holiday calendar", () => {
  it("computes Easter", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2028)).toBe("2028-04-16");
  });

  it("maps country names to codes", () => {
    expect(countryCode("Rwanda")).toBe("RW");
    expect(countryCode("United Arab Emirates")).toBe("AE");
    expect(countryCode("south africa")).toBe("ZA");
    expect(countryCode("Narnia")).toBeNull();
    expect(countryCode(null)).toBeNull();
  });

  it("uses each country's Mother's Day", () => {
    expect(find("United States", 2026, "mothers-day")).toEqual(["2026-05-10"]);
    expect(find("United Kingdom", 2026, "mothers-day")).toEqual(["2026-03-15"]); // Mothering Sunday
    expect(find("United Kingdom", 2027, "mothers-day")).toEqual(["2027-03-07"]);
    expect(find("France", 2026, "mothers-day")).toEqual(["2026-05-31"]);
    expect(find("Spain", 2026, "mothers-day")).toEqual(["2026-05-03"]);
    expect(find("United Arab Emirates", 2026, "mothers-day")).toEqual(["2026-03-21"]);
    expect(find("Kenya", 2027, "mothers-day")).toEqual(["2027-05-09"]);
  });

  it("uses each country's Father's Day", () => {
    expect(find("United States", 2026, "fathers-day")).toEqual(["2026-06-21"]);
    expect(find("Spain", 2026, "fathers-day")).toEqual(["2026-03-19"]);
    expect(find("Germany", 2026, "fathers-day")).toEqual(["2026-05-14"]); // Ascension
    expect(find("Germany", 2027, "fathers-day")).toEqual(["2027-05-06"]);
  });

  it("finds movable shopping days", () => {
    expect(find(null, 2026, "black-friday")).toEqual(["2026-11-27"]);
    expect(find(null, 2027, "black-friday")).toEqual(["2027-11-26"]);
    expect(find("United States", 2026, "us-thanksgiving")).toEqual(["2026-11-26"]);
    expect(find("United States", 2028, "us-memorial")).toEqual(["2028-05-29"]);
  });

  it("has the fixed national days", () => {
    expect(find("Rwanda", 2026, "rw-liberation")).toEqual(["2026-07-04"]);
    expect(find("Kenya", 2026, "ke-mashujaa")).toEqual(["2026-10-20"]);
    expect(find("Uganda", 2026, "ug-independence")).toEqual(["2026-10-09"]);
    expect(find("Tanzania", 2026, "tz-independence")).toEqual(["2026-12-09"]);
    expect(find("Nigeria", 2026, "ng-independence")).toEqual(["2026-10-01"]);
    expect(find("South Africa", 2026, "za-womens")).toEqual(["2026-08-09"]);
    expect(find("France", 2026, "fr-bastille")).toEqual(["2026-07-14"]);
    expect(find("Germany", 2026, "de-unity")).toEqual(["2026-10-03"]);
    expect(find("India", 2026, "in-republic")).toEqual(["2026-01-26"]);
    expect(find("United Arab Emirates", 2026, "ae-national")).toEqual(["2026-12-02"]);
    expect(find("United Kingdom", 2026, "uk-summer-bank")).toEqual(["2026-08-31"]);
  });

  it("follows Easter for movable religious days", () => {
    expect(find("Kenya", 2027, "good-friday")).toEqual(["2027-03-26"]);
    expect(find("France", 2026, "ascension")).toEqual(["2026-05-14"]);
    expect(find("France", 2026, "whit-monday")).toEqual(["2026-05-25"]);
  });

  it("finds Eid and Diwali, marked approximate and religious", () => {
    const fitr = holidaysForYear("Kenya", 2026).find((h) => h.id === "eid-al-fitr")!;
    expect(fitr.religious).toBe(true);
    expect(fitr.approximate).toBe(true);
    // Umm al-Qura puts 1 Shawwal 1447 on 20 March 2026; moon sighting may move it a day either way.
    expect(["2026-03-19", "2026-03-20", "2026-03-21"]).toContain(fitr.date);
    const adha = find("United Arab Emirates", 2026, "eid-al-adha")[0];
    expect(["2026-05-26", "2026-05-27", "2026-05-28"]).toContain(adha);
    expect(find("India", 2026, "diwali")).toEqual(["2026-11-08"]);
    expect(find("India", 2027, "diwali")).toEqual(["2027-10-29"]);
    expect(find("India", 2026, "holi")).toEqual(["2026-03-04"]);
  });

  it("marks remembrance days as sensitive", () => {
    const kwibuka = holidaysForYear("Rwanda", 2026).find((h) => h.id === "rw-kwibuka")!;
    expect(kwibuka.date).toBe("2026-04-07");
    expect(kwibuka.sensitive).toBe(true);
    expect(holidaysForYear("United Arab Emirates", 2026).find((h) => h.id === "ae-commemoration")?.sensitive).toBe(true);
  });

  it("skips religious holidays on request, keeps the rest", () => {
    const all = holidaysBetween("Kenya", "2026-12-20", "2026-12-31");
    const skipped = holidaysBetween("Kenya", "2026-12-20", "2026-12-31", { skipReligious: true });
    expect(all.some((h) => h.id === "christmas")).toBe(true);
    expect(skipped.some((h) => h.id === "christmas")).toBe(false);
    expect(skipped.some((h) => h.id === "new-years-eve")).toBe(true);
  });

  it("works across a year boundary and for unsupported countries (global days only)", () => {
    const days = holidaysBetween("Narnia", "2026-12-28", "2027-01-03");
    expect(days.map((h) => h.date)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("prefers the national name over the global one with the same id", () => {
    const labour = holidaysForYear("Uganda", 2026).filter((h) => h.date === "2026-05-01");
    expect(labour).toHaveLength(1);
  });
});
