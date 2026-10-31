import { z } from "zod";
import type { Manifest } from "./conference";
import { manifestSchema, type ConferenceState } from "./conference-state";

/** The live team row is capped at 5 MB by the database; warn well before it. */
export const ARCHIVE_WARNING_BYTES = 3_000_000;
/** Finished manifests older than this leave the live row automatically. */
export const ARCHIVE_AFTER_DAYS = 30;
/** Shortest waiting period the manual "archive now" action may request. */
export const ARCHIVE_EARLY_DAYS = 7;

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

export type ArchivedManifest = { manifest: Manifest; archivedAt: string };
export type ArchiveQuery = { ids?: string[]; ctcs?: string[]; hashes?: string[] };
export type FindArchived = (query: ArchiveQuery) => Promise<ArchivedManifest[]>;

const archivedSchema = z.array(z.object({ manifest: manifestSchema, archivedAt: z.string() }));

/** A database without the archive migration answers "function not found". */
export function missingRpc(error: { message?: string; code?: string } | null | undefined) {
  return (
    !!error &&
    (error.code === "PGRST202" ||
      error.code === "42883" ||
      /could not find the function|function .* does not exist/i.test(error.message ?? ""))
  );
}

/** Size of the snapshot as stored, in bytes. */
export function conferenceBytes(state: ConferenceState) {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

/** Number of manifests moved to the archive; 0 before the migration is applied. */
export async function archiveFinished(rpc: Rpc, minDays = ARCHIVE_AFTER_DAYS): Promise<number> {
  const result = await rpc("archive_conference_manifests", { min_days: minDays });
  if (missingRpc(result.error)) return 0;
  if (result.error) throw result.error;
  return z.number().int().nonnegative().parse(result.data);
}

/** Archived manifests sharing an ID, CTC or photo fingerprint with the query. */
export async function findArchived(rpc: Rpc, query: ArchiveQuery): Promise<ArchivedManifest[]> {
  const ids = [...new Set(query.ids ?? [])].filter(Boolean).slice(0, 500);
  const ctcs = [...new Set(query.ctcs ?? [])].filter((ctc) => /^\d{10}$/.test(ctc)).slice(0, 5000);
  const hashes = [...new Set((query.hashes ?? []).map((hash) => hash.toLowerCase()))]
    .filter((hash) => /^[a-f0-9]{64}$/.test(hash))
    .slice(0, 500);
  if (!ids.length && !ctcs.length && !hashes.length) return [];
  const result = await rpc("find_archived_conference_manifests", {
    manifest_ids: ids,
    ctc_numbers: ctcs,
    hashes,
  });
  if (missingRpc(result.error)) return [];
  if (result.error) throw result.error;
  return archivedSchema.parse(result.data);
}

/** Key for draft-driven lookups, so an unchanged batch is not queried again. */
export function archiveQueryKey(query: ArchiveQuery) {
  const sorted = (values?: string[]) => [...new Set(values ?? [])].sort().join(",");
  return `${sorted(query.ids)}|${sorted(query.ctcs)}|${sorted(query.hashes)}`;
}
