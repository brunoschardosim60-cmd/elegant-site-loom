import { AlertCircle, CheckCircle2, FileImage, Loader2, Plus } from "lucide-react";
import { Button } from "./ui/button";
import {
  documentCount,
  needsReview,
  statusText,
  volumeCount,
  type Draft,
} from "@/lib/import-draft";

/** Sidebar listing every photo or manual draft in the import, with its status. */
export function ImportQueue({
  items,
  active,
  conflictIndices,
  photoCount,
  detected,
  volumes,
  busy,
  onSelect,
  onAddManual,
}: {
  items: Draft[];
  active: number;
  conflictIndices: Set<number>;
  photoCount: number;
  detected: number;
  volumes: number;
  busy: boolean;
  onSelect: (index: number) => void;
  onAddManual: () => void;
}) {
  return (
    <aside className="import-queue" aria-label="Arquivos para importar">
      <div className="import-queue-heading">
        <div>
          <span className="import-eyebrow">Sua lista</span>
          <h3>
            {photoCount ? `${photoCount} ${photoCount === 1 ? "foto" : "fotos"}` : "Novo pré"}
          </h3>
        </div>
        <span className="import-queue-count">{items.length}</span>
      </div>
      <div className="import-batch-totals">
        <span>
          <strong>{detected}</strong> CTCs
        </span>
        <span>
          <strong>{volumes}</strong> volumes
        </span>
      </div>
      {items.length > 1 && (
        <label className="form-field import-mobile-select">
          Documento selecionado
          <select
            aria-label="Selecionar foto do lote"
            value={active}
            onChange={(event) => onSelect(Number(event.target.value))}
          >
            {items.map((item, i) => (
              <option key={item.key} value={i}>
                {i + 1}. {item.id || item.filename} ·{" "}
                {conflictIndices.has(i) ? "Cadastro duplicado" : statusText(item)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="import-queue-list">
        {items.map((item, index) => (
          <button
            type="button"
            className="import-queue-item"
            key={item.key}
            aria-label={`Revisar arquivo ${index + 1}: ${item.id || item.filename}`}
            aria-pressed={index === active}
            onClick={() => onSelect(index)}
          >
            <div className="import-queue-thumb">
              {item.url ? <img src={item.url} alt="" /> : <FileImage size={22} />}
              <span>{index + 1}</span>
            </div>
            <div className="import-queue-copy">
              <strong>
                {item.id ||
                  (item.kind === "dacte"
                    ? "DACTE"
                    : item.file
                      ? item.status === "waiting" || item.status === "reading"
                        ? "Identificando pré…"
                        : "Pré sem número"
                      : "Cadastro manual")}
              </strong>
              <small>{item.driver || item.filename}</small>
              <span
                className={`import-file-status ${conflictIndices.has(index) || needsReview(item) ? "warning" : item.status === "read" ? "success" : ""}`}
              >
                {conflictIndices.has(index) ? (
                  <AlertCircle />
                ) : item.status === "reading" ? (
                  <Loader2 className="animate-spin" />
                ) : item.status === "error" ? (
                  <AlertCircle />
                ) : item.status === "read" ? (
                  <CheckCircle2 />
                ) : null}
                {conflictIndices.has(index) ? "Cadastro duplicado" : statusText(item)}
              </span>
              {item.status === "reading" && item.progress && (
                <span className="import-queue-progress">{item.progress}</span>
              )}
              {item.status === "read" && (
                <span className="import-queue-numbers">
                  {documentCount(item)} CTCs · {volumeCount(item)} volumes
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="import-manual-button"
        disabled={busy}
        onClick={onAddManual}
      >
        <Plus size={15} />
        Adicionar pré manualmente
      </Button>
      <p className="import-draft-note">
        Os documentos só serão salvos ao cadastrar. Fechar descarta os rascunhos e as fotos.
      </p>
    </aside>
  );
}
