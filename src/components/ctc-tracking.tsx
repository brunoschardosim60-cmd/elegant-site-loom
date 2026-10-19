import { useRef, useState } from "react";
import { ArrowRight, CheckCheck, Clock3, History, Search } from "lucide-react";
import { Button } from "./ui/button";
import { ActionActor } from "./action-actor";
import { NfOccurrences } from "./nf-occurrences";
import { DocumentPagination, documentPageSize as pageSize } from "./document-pagination";
import { conferenceTimestamp, type TrackingRow, type TrackingStatus } from "@/lib/ctc-tracking";
import {
  formatManifestDate,
  manifestAgeLabel,
  manifestReferenceDate,
  normalizeIssueDate,
} from "@/lib/manifest-date";

export function CtcTracking({
  rows,
  status,
  onStatusChange,
  scope,
  now,
  onAuditManifest,
  personal = false,
}: {
  rows: TrackingRow[];
  status: TrackingStatus;
  onStatusChange: (value: TrackingStatus) => void;
  scope: string;
  now: string;
  onAuditManifest?: ((id: string) => void) | undefined;
  personal?: boolean;
}) {
  const [pagination, setPagination] = useState({ scope, page: 0 });
  const tableRef = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = pagination.scope === scope ? Math.min(pagination.page, pages - 1) : 0;
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <section className="ctc-tracking" aria-label="Consulta de CTCs">
      <div className="tracking-tools">
        <label>
          Status do CTC
          <select
            className="filter-select"
            aria-label="Status do CTC"
            value={status}
            onChange={(event) => onStatusChange(event.target.value as TrackingStatus)}
          >
            <option value="all">Todos os status</option>
            <option value="pending">Pendentes</option>
            <option value="received">Conferidos</option>
            <option value="rerouted">Remanifestados</option>
          </select>
        </label>
        <p role="status">
          {rows.length} CTC{rows.length === 1 ? "" : "s"} encontrado{rows.length === 1 ? "" : "s"}
          <span>
            Horários de Brasília ·{" "}
            {personal ? "consulta dos seus cadastros" : "consulta dos cadastros da equipe"}
          </span>
        </p>
      </div>
      {visible.length ? (
        <div
          ref={tableRef}
          tabIndex={0}
          role="region"
          aria-label="Tabela de rastreamento de CTCs"
          className="manifest-card tracking-table-wrap paged-documents"
        >
          <table className="document-table tracking-table" aria-label="Rastreamento de CTCs">
            <thead>
              <tr>
                <th>CTC / Nota fiscal</th>
                <th>Pré / Motorista</th>
                <th>Vols.</th>
                <th>Status</th>
                <th>Conferência</th>
                {onAuditManifest && (
                  <th>
                    <span className="sr-only">Histórico</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ manifest, doc }) => {
                const timestamp = doc.received ? conferenceTimestamp(doc.receivedAt) : undefined;
                return (
                  <tr
                    key={`${manifest.id}:${doc.id}`}
                    className={doc.received ? "received-row" : ""}
                  >
                    <td data-label="CTC / Nota fiscal" className="ctc-number">
                      <strong className="ctc-identifier">{doc.ctc}</strong>
                      <div className="tracking-detail">
                        <NfOccurrences nf={doc.nf} values={doc.nfOccurrences} prefix />
                      </div>
                      {doc.client && <span className="tracking-detail">{doc.client}</span>}
                      {doc.recipient && (
                        <span className="tracking-detail">Para: {doc.recipient}</span>
                      )}
                    </td>
                    <td data-label="Pré / Motorista">
                      <strong>{manifest.id}</strong>
                      <span className="tracking-detail">
                        {manifest.driver} · <span className="plate">{manifest.plate}</span>
                      </span>
                      <span className="tracking-detail">
                        {normalizeIssueDate(manifest.issueDate ?? "")
                          ? /^\d{8,12}$/.test(manifest.id)
                            ? "Manifestado em"
                            : "Emissão"
                          : "Cadastro"}{" "}
                        {formatManifestDate(manifestReferenceDate(manifest))}
                        {manifest.issueTime && ` às ${manifest.issueTime}`}
                      </span>
                      {!!doc.deliveryDates?.length && (
                        <span className="tracking-detail">
                          Prev. entrega: {doc.deliveryDates.map(formatManifestDate).join(", ")}
                        </span>
                      )}
                    </td>
                    <td data-label="Volumes">{doc.volumes}</td>
                    <td data-label="Status">
                      <span
                        className={`status-badge ${doc.received ? "badge-success" : doc.reroutedTo ? "badge-warning" : "badge-pending"}`}
                      >
                        {doc.received ? (
                          <CheckCheck size={12} />
                        ) : doc.reroutedTo ? (
                          <ArrowRight size={12} />
                        ) : (
                          <Clock3 size={12} />
                        )}
                        {doc.received ? "Conferido" : doc.reroutedTo ? "Remanifestado" : "Pendente"}
                      </span>
                      {!doc.received && !doc.reroutedTo && (
                        <span className="tracking-detail">{manifestAgeLabel(manifest, now)}</span>
                      )}
                    </td>
                    <td data-label="Conferência">
                      {doc.received && !personal && (
                        <ActionActor label="Conferido por" email={doc.receivedByEmail} />
                      )}
                      {doc.received ? (
                        timestamp ? (
                          <time dateTime={doc.receivedAt}>{timestamp}</time>
                        ) : (
                          <span className="tracking-detail">Horário não registrado</span>
                        )
                      ) : (
                        <span className="tracking-detail">
                          {doc.reroutedTo
                            ? `Nova rota: ${doc.reroutedTo}`
                            : "Aguardando conferência"}
                        </span>
                      )}
                    </td>
                    {onAuditManifest && (
                      <td data-label="Histórico">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="document-action"
                          aria-label={`Histórico do CTC ${doc.ctc}`}
                          title="Consultar histórico do pré"
                          onClick={() => onAuditManifest(manifest.id)}
                        >
                          <History size={15} />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Search />
          <h3>Nenhum CTC encontrado</h3>
          <p className="text-xs mt-2">
            Confira a busca e os filtros. A consulta inclui prés abertos e finalizados.
          </p>
        </div>
      )}
      <DocumentPagination
        total={rows.length}
        page={page}
        onPageChange={(next) => setPagination({ scope, page: next })}
        label="Páginas do rastreamento"
        targetRef={tableRef}
      />
    </section>
  );
}
