import { useEffect, useRef, useState } from "react";
import type { Manifest } from "@/lib/conference";
import { archiveQueryKey, type FindArchived } from "@/lib/conference-archive";
import type { ImportDraft } from "@/lib/manifest-import";

const LOOKUP_DELAY_MS = 400;

/**
 * Archived manifests that share an ID, CTC or photo with the drafts, labelled
 * so conflict messages say where the existing record is. They are used only as
 * extra duplicate sources: never as link targets and never edited.
 */
export function useArchivedManifests(
  find: FindArchived | undefined,
  drafts: Pick<ImportDraft, "id" | "targetId" | "rows" | "sourcePhotoHash">[],
): Manifest[] {
  const query = {
    ids: drafts.flatMap((draft) =>
      draft.targetId || !draft.id.trim() ? [] : [draft.id.trim().toUpperCase()],
    ),
    ctcs: drafts.flatMap((draft) => draft.rows.map((row) => row.ctc.trim())),
    hashes: drafts.flatMap((draft) => (draft.sourcePhotoHash ? [draft.sourcePhotoHash] : [])),
  };
  const key = archiveQueryKey(query);
  const latest = useRef(query);
  latest.current = query;
  const [found, setFound] = useState<Manifest[]>([]);
  useEffect(() => {
    if (!find || key === "||") return;
    let active = true;
    const timer = window.setTimeout(() => {
      find(latest.current)
        .then((list) => {
          if (active)
            setFound(
              list.map(({ manifest }) => ({
                ...manifest,
                driver: `${manifest.driver} · arquivado`,
              })),
            );
        })
        // The live save still rejects archived duplicates; a failed lookup only
        // means the warning appears at save time instead of during review.
        .catch(() => {});
    }, LOOKUP_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [find, key]);
  return found;
}
