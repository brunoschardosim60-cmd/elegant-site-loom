import type { Manifest } from "./conference";
import type { ImportDraft } from "./manifest-import";

/** Comparable recipient name: no accents, case or extra spaces. */
export const recipientKey = (name: string | undefined) =>
  (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Delivery city most often recorded for each recipient, learned from what is
 * already registered (the 108 export brings the city, photos and manual
 * entries do not). A recipient always delivered in one city keeps it.
 */
export function knownCities(manifests: Manifest[]) {
  const counts = new Map<string, Map<string, number>>();
  for (const manifest of manifests)
    for (const doc of manifest.documents) {
      const key = recipientKey(doc.recipient);
      const city = doc.city?.trim();
      if (!key || !city) continue;
      const cities = counts.get(key) ?? new Map<string, number>();
      cities.set(city, (cities.get(city) ?? 0) + 1);
      counts.set(key, cities);
    }
  return new Map(
    [...counts].map(([key, cities]) => [
      key,
      [...cities].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
    ]),
  );
}

/** Fills the delivery city of CTCs that have none, from their recipient. */
export function fillCities(drafts: ImportDraft[], manifests: Manifest[]): ImportDraft[] {
  const known = knownCities(manifests);
  if (!known.size) return drafts;
  return drafts.map((draft) => ({
    ...draft,
    rows: draft.rows.map((row) => {
      if (row.city?.trim()) return row;
      const city = known.get(recipientKey(row.recipient));
      return city ? { ...row, city } : row;
    }),
  }));
}
