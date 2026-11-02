import type { RefObject } from "react";
import { Check, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentItem, Manifest } from "@/lib/conference";
import {
  formatManifestDate,
  manifestAgeLabel,
  manifestReferenceDate,
  normalizeIssueDate,
} from "@/lib/manifest-date";
import { DocumentPagination } from "./document-pagination";
import { NfOccurrences } from "./nf-occurrences";
import { CargoTags } from "./cargo-tags";

export type PendingRow = { manifest: Manifest; doc: DocumentItem; days: number };

/** Paged table of CTCs still awaiting return, with a quick "received" action. */
export function PendingTable({
  rows,
  total,
  page,
  onPageChange,
  tableRef,
  now,
  readOnly,
  onReceive,
}: {
  rows: PendingRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  tableRef: RefObject<HTMLDivElement | null>;
  now: string;
  readOnly: boolean;
  onReceive: (manifest: Manifest, documentId: string) => void;
}) {
  return (
    <>
      <div
        ref={tableRef}
        tabIndex={0}
        role="region"
        aria-label="Tabela de CTCs pendentes"
        className="manifest-card pending-table-wrap paged-documents"
      >
        <table className="document-table pending-table" aria-label="CTCs pendentes">
          <thead>
            <tr>
              <th>CTC</th>
              <th>Pré / Motorista</th>
              <th>NF</th>
              <th>Vols.</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ manifest, doc, days }) => (
              <tr key={`${manifest.id}:${doc.id}`}>
                <td className="ctc-number" data-label="CTC / Cliente">
                  <span className="ctc-identifier">{doc.ctc}</span>
                  <CargoTags doc={doc} />
                  {doc.client && (
                    <span className="block text-muted-foreground text-[10px] font-sans mt-1">
                      {doc.client}
                    </span>
                  )}
                </td>
                <td data-label="Pré / Motorista">
                  <span className="block font-semibold">{manifest.id}</span>
                  <span className="text-muted-foreground">
                    {manifest.driver} · <span className="plate">{manifest.plate}</span>
                  </span>
                  <span className="block text-muted-foreground text-[10px] mt-1">
                    {normalizeIssueDate(manifest.issueDate ?? "")
                      ? /^\d{8,12}$/.test(manifest.id)
                        ? "Manifestado em"
                        : "Emissão"
                      : "Cadastro"}{" "}
                    {formatManifestDate(manifestReferenceDate(manifest))}
                  </span>
                </td>
                <td className="text-muted-foreground" data-label="Nota fiscal">
                  <NfOccurrences nf={doc.nf} values={doc.nfOccurrences} />
                </td>
                <td data-label="Volumes">{doc.volumes}</td>
                <td data-label="Status">
                  <span className={`status-badge ${days >= 2 ? "badge-warning" : "badge-pending"}`}>
                    <Clock3 size={10} />
                    Pendente
                  </span>
                  <span className="tracking-detail">{manifestAgeLabel(manifest, now)}</span>
                </td>
                <td data-label="Ações">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="document-action text-muted-foreground"
                    disabled={readOnly}
                    aria-label={`Marcar CTC ${doc.ctc} como recebido`}
                    onClick={() => onReceive(manifest, doc.id)}
                  >
                    <Check />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocumentPagination
        total={total}
        page={page}
        onPageChange={onPageChange}
        label="Páginas das pendências"
        targetRef={tableRef}
      />
    </>
  );
}
