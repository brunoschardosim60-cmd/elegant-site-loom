import { isExportManifest, manifestNoun } from "@/lib/manifest-id";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  History,
  Package,
  Pencil,
  Trash2,
  Truck,
  Undo2,
  UserRound,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionActor } from "./action-actor";
import { AcceptTeamReceipt } from "./accept-team-receipt";
import { NfOccurrences } from "./nf-occurrences";
import { reviewManifestTotals } from "@/lib/manifest-review";
import type { Manifest } from "@/lib/conference";
import { isPendingDocument } from "@/lib/conference-routes";
import {
  formatManifestDate,
  manifestAgeLabel,
  manifestReferenceDate,
  normalizeIssueDate,
} from "@/lib/manifest-date";

type Props = {
  personal?: boolean;
  readOnly?: boolean;
  manifests: Manifest[];
  query: string;
  focusedManifest: { id: string } | null;
  age: (manifest: Manifest) => number;
  now?: string;
  onToggleDocument: (manifest: Manifest, id: string, received: boolean) => void;
  onAcceptReceipt?: ((manifest: Manifest, id: string) => void) | undefined;
  onIssueDateChange?: (manifestId: string, issueDate: string | undefined) => void;
  onDeleteManifest?: (id: string) => void;
  onEditManifest?: (manifest: Manifest) => void;
  onAuditManifest?: ((id: string) => void) | undefined;
};

const driverKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
const countVolumes = (manifests: Manifest[], pendingOnly = false) =>
  manifests.reduce(
    (total, manifest) =>
      total +
      manifest.documents.reduce(
        (sum, doc) => sum + (!pendingOnly || isPendingDocument(doc) ? doc.volumes : 0),
        0,
      ),
    0,
  );

/** Keeps every driver's manifests together while opening only the table being used. */
export function DriverManifestList({
  personal = false,
  readOnly = false,
  manifests,
  query,
  focusedManifest,
  age,
  now,
  onToggleDocument,
  onAcceptReceipt,
  onIssueDateChange,
  onDeleteManifest,
  onAuditManifest,
  onEditManifest,
}: Props) {
  const [expanded, setExpanded] = useState(manifests[0]?.id ?? "");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [editingDate, setEditingDate] = useState<{
    id: string;
    value: string;
    error?: string;
  } | null>(null);
  const groups = new Map<string, { driver: string; manifests: Manifest[] }>();
  for (const manifest of manifests) {
    const key = driverKey(manifest.driver);
    const group = groups.get(key);
    if (group) group.manifests.push(manifest);
    else groups.set(key, { driver: manifest.driver, manifests: [manifest] });
  }
  const firstManifestId = manifests[0]?.id ?? "";
  const expandedVisible = !expanded || manifests.some((manifest) => manifest.id === expanded);
  useEffect(() => {
    if (!expandedVisible) setExpanded(firstManifestId);
  }, [expandedVisible, firstManifestId]);
  useEffect(() => {
    if (query.trim()) {
      setExpanded(firstManifestId);
      setCollapsedGroups(new Set());
    }
  }, [query, firstManifestId]);
  const focusedDriverKey = driverKey(
    manifests.find((manifest) => manifest.id === focusedManifest?.id)?.driver ?? "",
  );
  useEffect(() => {
    if (focusedManifest) {
      setExpanded(focusedManifest.id);
      setCollapsedGroups((old) => {
        if (!old.has(focusedDriverKey)) return old;
        const next = new Set(old);
        next.delete(focusedDriverKey);
        return next;
      });
    }
  }, [focusedManifest, focusedDriverKey]);

  return (
    <div className="driver-list">
      <div className="driver-list-caption">
        <UserRound size={14} />
        <span>
          {groups.size} {groups.size === 1 ? "motorista" : "motoristas"} · {manifests.length}{" "}
          {manifests.length === 1 ? "manifesto" : "manifestos"}
        </span>
        <span>Selecione um manifesto para {readOnly ? "consultar" : "conferir"}</span>
      </div>
      {[...groups.entries()].map(([key, group]) => {
        const pendingCount = group.manifests.reduce(
          (sum, manifest) => sum + manifest.documents.filter(isPendingDocument).length,
          0,
        );
        const documentCount = group.manifests.reduce(
          (sum, manifest) => sum + manifest.documents.length,
          0,
        );
        const pendingVolumes = countVolumes(group.manifests, true);
        const plates = [...new Set(group.manifests.map((manifest) => manifest.plate))];
        return (
          <section
            className="driver-group"
            aria-label={`Pré-manifestos de ${group.driver}`}
            key={key}
          >
            <header className="driver-group-heading">
              <div className="driver-group-avatar" aria-hidden="true">
                {initials(group.driver)}
              </div>
              <div className="driver-group-person">
                <h3>{group.driver}</h3>
                <p>
                  <Truck size={12} />
                  <span>{plates.join(" · ")}</span>
                  <span className="driver-group-separator">/</span>
                  <span>
                    {group.manifests.length}{" "}
                    {group.manifests.length === 1 ? "manifesto" : "manifestos"}
                  </span>
                </p>
              </div>
              <div className={`driver-group-totals ${pendingCount ? "" : "driver-group-done"}`}>
                <span>
                  <FileText size={13} />
                  <strong>{pendingCount || documentCount}</strong>{" "}
                  {pendingCount
                    ? pendingCount === 1
                      ? "CTC pendente"
                      : "CTCs pendentes"
                    : documentCount === 1
                      ? "CTC encerrado"
                      : "CTCs encerrados"}
                </span>
                <span>
                  <Package size={13} />
                  <strong>
                    {pendingCount ? pendingVolumes : countVolumes(group.manifests)}
                  </strong>{" "}
                  {pendingCount ? "vols. a conferir" : "vols. encerrados"}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="driver-group-toggle h-8 shrink-0 gap-1 px-2 text-xs"
                aria-expanded={!collapsedGroups.has(key)}
                aria-label={`${collapsedGroups.has(key) ? "Mostrar" : "Recolher"} manifestos de ${group.driver}`}
                onClick={() =>
                  setCollapsedGroups((old) => {
                    const next = new Set(old);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                <ChevronDown
                  size={15}
                  className={
                    collapsedGroups.has(key)
                      ? "-rotate-90 transition-transform"
                      : "transition-transform"
                  }
                />
                <span className="hidden sm:inline">
                  {collapsedGroups.has(key) ? "Mostrar" : "Recolher"}
                </span>
              </Button>
            </header>
            {!collapsedGroups.has(key) && (
              <div className="driver-manifests">
                {group.manifests.map((manifest) => {
                  const totalsReview = reviewManifestTotals(
                    manifest.documents.map((doc) => ({
                      ...doc,
                      client: doc.client ?? "",
                      recipient: doc.recipient ?? "",
                      volumes: String(doc.volumes),
                    })),
                    manifest,
                  );
                  const count = manifest.documents.filter((doc) => doc.received).length;
                  const rerouted = manifest.documents.filter(
                    (doc) => !doc.received && doc.reroutedTo,
                  ).length;
                  const remaining = manifest.documents.filter(isPendingDocument).length;
                  const pendingVols = countVolumes([manifest], true);
                  const days = age(manifest);
                  const noun = manifestNoun(manifest.id);
                  const dateLabel = normalizeIssueDate(manifest.issueDate ?? "")
                    ? isExportManifest(manifest.id)
                      ? "Manifestado em"
                      : "Emissão"
                    : "Cadastro";
                  const open = expanded === manifest.id;
                  const tableId = `driver-documents-${manifest.id}`;
                  const percent = manifest.documents.length
                    ? Math.round(((count + rerouted) / manifest.documents.length) * 100)
                    : 0;
                  return (
                    <article
                      className={`driver-manifest ${open ? "driver-manifest-open" : ""}`}
                      key={manifest.id}
                    >
                      <button
                        type="button"
                        className="driver-manifest-trigger"
                        aria-expanded={open}
                        aria-controls={tableId}
                        aria-label={`${open ? "Recolher" : "Abrir"} documentos do ${noun} ${manifest.id}`}
                        onClick={() => setExpanded(open ? "" : manifest.id)}
                      >
                        <div className="driver-manifest-title">
                          <span className="driver-manifest-id">
                            {isExportManifest(manifest.id)
                              ? `Manifesto ${manifest.id}`
                              : manifest.id}
                          </span>
                          <span className="driver-manifest-date">
                            {dateLabel} {formatManifestDate(manifestReferenceDate(manifest))}
                            {manifest.issueTime && ` às ${manifest.issueTime}`}
                            <span>·</span>
                            <span className="plate">{manifest.plate}</span>
                          </span>
                        </div>
                        <div className="driver-manifest-summary">
                          <span
                            className={`status-badge ${manifest.finishedAt || manifest.routeResolved ? "badge-success" : days >= 2 ? "badge-warning" : "badge-pending"}`}
                          >
                            {manifest.finishedAt || manifest.routeResolved ? (
                              <Check size={11} />
                            ) : (
                              <Clock3 size={11} />
                            )}
                            {manifest.finishedAt
                              ? "Finalizado"
                              : manifest.routeResolved
                                ? "Rota encerrada"
                                : manifestAgeLabel(manifest, now)}
                          </span>
                          <span className="driver-manifest-missing">
                            {remaining ? (
                              <>
                                <strong>{remaining}</strong> {remaining === 1 ? "CTC" : "CTCs"} ·{" "}
                                <strong>{pendingVols}</strong> vols. faltando
                              </>
                            ) : (
                              <>
                                {count} {count === 1 ? "CTC conferido" : "CTCs conferidos"}
                                {rerouted > 0 && ` · ${rerouted} remanifestado(s)`}
                              </>
                            )}
                          </span>
                        </div>
                        <ChevronDown
                          className="driver-manifest-chevron"
                          size={17}
                          aria-hidden="true"
                        />
                      </button>
                      {(onIssueDateChange ||
                        onDeleteManifest ||
                        onAuditManifest ||
                        onEditManifest) && (
                        <div className="driver-manifest-date-editor px-3 pb-1 flex flex-wrap items-center gap-x-1 gap-y-1">
                          {!readOnly &&
                            onIssueDateChange &&
                            (editingDate?.id === manifest.id ? (
                              <form
                                className="flex min-w-0 flex-wrap items-center gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const value = editingDate.value.trim();
                                  const issueDate = normalizeIssueDate(value);
                                  if (value && !issueDate) {
                                    setEditingDate({
                                      ...editingDate,
                                      error: "Informe uma data válida.",
                                    });
                                    return;
                                  }
                                  onIssueDateChange(manifest.id, issueDate);
                                  setEditingDate(null);
                                }}
                              >
                                <label
                                  htmlFor={`issue-date-${manifest.id}`}
                                  className="text-[11px] text-muted-foreground"
                                >
                                  Emissão do {noun}
                                </label>
                                <Input
                                  id={`issue-date-${manifest.id}`}
                                  aria-label={`Data de emissão do ${noun} ${manifest.id}`}
                                  type="date"
                                  min="1000-01-01"
                                  max="9999-12-31"
                                  className="h-8 w-40 text-xs"
                                  value={editingDate.value}
                                  onChange={(event) =>
                                    setEditingDate({ id: manifest.id, value: event.target.value })
                                  }
                                />
                                <Button type="submit" size="sm" className="h-8">
                                  Salvar data
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8"
                                  onClick={() => setEditingDate(null)}
                                >
                                  Cancelar
                                </Button>
                                <span className="basis-full text-[10px] text-muted-foreground">
                                  Use a data impressa no cabeçalho. Em branco, a idade usa o
                                  cadastro.
                                </span>
                                {editingDate.error && (
                                  <span
                                    role="alert"
                                    className="basis-full text-xs text-destructive"
                                  >
                                    {editingDate.error}
                                  </span>
                                )}
                              </form>
                            ) : (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                                aria-label={`Editar data do ${noun} ${manifest.id}`}
                                onClick={() =>
                                  setEditingDate({
                                    id: manifest.id,
                                    value: normalizeIssueDate(manifest.issueDate ?? "") ?? "",
                                  })
                                }
                              >
                                <CalendarDays size={13} />
                                <span>Data</span>
                              </button>
                            ))}
                          {!readOnly && onEditManifest && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={`Editar ${noun} ${manifest.id}`}
                              onClick={() => onEditManifest(manifest)}
                            >
                              <Pencil size={13} />
                              <span>Editar</span>
                            </button>
                          )}
                          {!readOnly && onDeleteManifest && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-destructive [&_svg]:size-3"
                              aria-label={`Excluir ${noun} ${manifest.id}`}
                              onClick={() => onDeleteManifest(manifest.id)}
                            >
                              <Trash2 size={12} aria-hidden="true" />
                              <span>Excluir</span>
                            </Button>
                          )}
                          {onAuditManifest && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={`Histórico do ${noun} ${manifest.id}`}
                              title="Ver responsáveis e histórico de alterações"
                              onClick={() => onAuditManifest(manifest.id)}
                            >
                              <History size={13} />
                              <span>Histórico</span>
                            </button>
                          )}
                        </div>
                      )}
                      {!!totalsReview.messages.length && (
                        <p role="status" className="px-4 pb-2 text-[11px] text-amber-700">
                          {totalsReview.messages.join(" ")} Totais revisados manualmente; use Editar
                          pré para corrigir.
                        </p>
                      )}
                      <div className="driver-manifest-progress">
                        <div className="driver-manifest-progress-label">
                          <span>
                            {count} de {manifest.documents.length} CTCs conferidos
                            {rerouted > 0 && ` · ${rerouted} remanifestado(s)`}
                          </span>
                          <strong>{percent}%</strong>
                        </div>
                        <div
                          className="driver-manifest-progress-track"
                          role="progressbar"
                          aria-label={`Conferência de ${group.driver} · ${manifest.id}`}
                          aria-valuenow={count + rerouted}
                          aria-valuemin={0}
                          aria-valuemax={manifest.documents.length}
                        >
                          <span style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                      {open && (
                        <div className="driver-document-panel" id={tableId}>
                          <table className="document-table driver-document-table">
                            <thead>
                              <tr>
                                <th>CTC / Cliente</th>
                                <th>Nota fiscal</th>
                                <th>Vols.</th>
                                <th>Status</th>
                                <th>
                                  <span className="sr-only">Ações</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...manifest.documents]
                                .sort((a, b) => Number(a.received) - Number(b.received))
                                .map((doc) => (
                                  <tr key={doc.id} className={doc.received ? "received-row" : ""}>
                                    <td className="ctc-number" data-label="CTC / Cliente">
                                      <span className="ctc-identifier">{doc.ctc}</span>
                                      {doc.client && (
                                        <span className="driver-document-client">{doc.client}</span>
                                      )}
                                      {doc.recipient && (
                                        <span className="driver-document-recipient">
                                          Para: {doc.recipient}
                                        </span>
                                      )}
                                    </td>
                                    <td data-label="Nota fiscal">
                                      <NfOccurrences nf={doc.nf} values={doc.nfOccurrences} />
                                    </td>
                                    <td data-label="Volumes">{doc.volumes}</td>
                                    <td data-label="Status">
                                      <span
                                        className={`status-badge ${doc.received ? "badge-success" : doc.reroutedTo ? "badge-warning" : "badge-pending"}`}
                                      >
                                        {doc.received ? (
                                          <Check size={12} aria-hidden="true" />
                                        ) : doc.reroutedTo ? (
                                          <ArrowRight size={12} aria-hidden="true" />
                                        ) : (
                                          <Clock3 size={12} aria-hidden="true" />
                                        )}
                                        {doc.received
                                          ? "Conferido"
                                          : doc.reroutedTo
                                            ? "Remanifestado"
                                            : "Pendente"}
                                      </span>
                                      {!readOnly && onAcceptReceipt && (
                                        <AcceptTeamReceipt
                                          doc={doc}
                                          onAccept={() => onAcceptReceipt(manifest, doc.id)}
                                        />
                                      )}
                                      {doc.received && (
                                        <ActionActor
                                          label="Conferido por"
                                          hideAuthor={personal}
                                          email={doc.receivedByEmail}
                                          at={doc.receivedAt}
                                        />
                                      )}
                                      {doc.reroutedTo && (
                                        <span className="block mt-1 text-xs text-muted-foreground">
                                          Nova rota: {doc.reroutedTo}
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      {!readOnly && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="document-action text-muted-foreground"
                                          disabled={!!doc.reroutedTo}
                                          title={
                                            doc.received
                                              ? `Desfazer CTC ${doc.ctc}`
                                              : `Marcar CTC ${doc.ctc} como recebido`
                                          }
                                          aria-label={
                                            doc.received
                                              ? `Desfazer CTC ${doc.ctc}`
                                              : `Marcar CTC ${doc.ctc} como recebido`
                                          }
                                          onClick={() =>
                                            onToggleDocument(manifest, doc.id, !doc.received)
                                          }
                                        >
                                          {doc.received ? <Undo2 /> : <Check />}
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
