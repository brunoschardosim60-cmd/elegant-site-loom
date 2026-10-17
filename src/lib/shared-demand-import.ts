import type { Manifest } from "./conference";
import { belongsTo, type DemandOwner } from "./conference-ownership";
import {
  applyImports,
  findImportConflicts,
  type ImportDraft,
  type ImportOutcome,
} from "./manifest-import";

const text = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const documents = (manifest: Manifest) =>
  JSON.stringify(
    manifest.documents
      .map((doc) => ({
        ctc: doc.ctc,
        nfs: [...new Set(doc.nf.split(",").map(text))].sort(),
        volumes: doc.volumes,
      }))
      .sort((a, b) => a.ctc.localeCompare(b.ctc)),
  );

export function demandImportStatus(
  existing: Manifest[],
  draft: ImportDraft,
  owner?: DemandOwner,
  enabled = false,
) {
  const saved = existing.find((m) => text(m.id) === text(draft.id));
  if (!saved || !owner?.userId || draft.targetId)
    return { kind: findImportConflicts(existing, [draft]).length ? "conflict" : "create" } as const;
  const candidate = applyImports([], [draft], "2026-01-01T00:00:00Z");
  const fresh = candidate.ok ? candidate.manifests[0] : undefined;
  if (
    !fresh ||
    text(saved.driver) !== text(fresh.driver) ||
    text(saved.plate) !== text(fresh.plate) ||
    saved.issueDate !== fresh.issueDate ||
    (saved.issueTime && fresh.issueTime && saved.issueTime !== fresh.issueTime) ||
    documents(saved) !== documents(fresh)
  )
    return {
      kind: "conflict",
      message: "Já existe na equipe com dados diferentes. Confira o manifesto antes de vincular.",
    } as const;
  if (belongsTo(saved, owner))
    return { kind: "mine", message: "Já está nas suas demandas" } as const;
  if (!enabled)
    return {
      kind: "conflict",
      message: "Já está na equipe. A vinculação às suas demandas aguarda atualização do banco.",
    } as const;
  return {
    kind: "link",
    message: "Adicionar às minhas demandas · sem duplicar na equipe",
  } as const;
}

/** Link a second account to the same canonical record. Never reset receipts or overwrite source fields. */
export function applyDemandImports(
  existing: Manifest[],
  drafts: ImportDraft[],
  owner: DemandOwner,
  now: string,
  enabled: boolean,
): ImportOutcome {
  const statuses = drafts.map((draft) => demandImportStatus(existing, draft, owner, enabled));
  const invalid = statuses.findIndex((status) => status.kind === "conflict");
  if (invalid >= 0)
    return {
      ok: false,
      index: invalid,
      error: statuses[invalid]!.message ?? "Confira o manifesto já cadastrado na equipe.",
    };
  const newDrafts = drafts.filter((_, index) => statuses[index]!.kind === "create");
  const added = applyImports(existing, newDrafts, now);
  if (!added.ok) return { ...added, index: drafts.indexOf(newDrafts[added.index]!) };
  const links = new Set(
    drafts.filter((_, i) => statuses[i]!.kind === "link").map((draft) => text(draft.id)),
  );
  return {
    ok: true,
    manifests: added.manifests.map((manifest) =>
      links.has(text(manifest.id))
        ? {
            ...manifest,
            demandUserIds: [...new Set([...(manifest.demandUserIds ?? []), owner.userId!])].sort(),
          }
        : manifest,
    ),
  };
}
