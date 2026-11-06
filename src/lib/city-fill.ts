import type { Manifest } from "./conference";
import type { ImportDraft } from "./manifest-import";
import { cityKey } from "./city-map";

/** Comparable recipient name: no accents, case or extra spaces. */
export const recipientKey = (name: string | undefined) =>
  (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * The delivery city of each recipient that has only ever been delivered in
 * one city, learned from what is already registered (the 108 export brings
 * the city; photos and manual entries do not). A recipient seen in two or
 * more cities is ambiguous and gets none: a wrong city would mislead the map.
 */
export function knownCities(manifests: Manifest[]) {
  const seen = new Map<string, Map<string, string>>();
  for (const manifest of manifests)
    for (const doc of manifest.documents) {
      const key = recipientKey(doc.recipient);
      const city = doc.city?.trim();
      if (!key || !city) continue;
      // "Gravataí" and "GRAVATAI - RS" are one city.
      const cities = seen.get(key) ?? new Map<string, string>();
      if (!cities.has(cityKey(city))) cities.set(cityKey(city), city);
      seen.set(key, cities);
    }
  const known = new Map<string, string>();
  for (const [key, cities] of seen) if (cities.size === 1) known.set(key, [...cities.values()][0]!);
  return known;
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

/**
 * The same manifests with each CTC lacking a city given its recipient's known
 * one, for the indicators only (nothing is saved). Older photo and manual
 * entries then show on the map too.
 */
export function withKnownCities(manifests: Manifest[]): Manifest[] {
  const known = knownCities(manifests);
  if (!known.size) return manifests;
  return manifests.map((manifest) =>
    manifest.documents.some((doc) => !doc.city?.trim() && known.has(recipientKey(doc.recipient)))
      ? {
          ...manifest,
          documents: manifest.documents.map((doc) => {
            if (doc.city?.trim()) return doc;
            const city = known.get(recipientKey(doc.recipient));
            return city ? { ...doc, city } : doc;
          }),
        }
      : manifest,
  );
}
