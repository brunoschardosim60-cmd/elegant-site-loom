import { AlertCircle, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import "./manifest-documents-editor.css";

export type ManifestDraftRow = {
  ctc: string;
  nf: string;
  volumes: string;
  client?: string;
  recipient?: string;
  review?: string[];
  deliveryDate?: string | undefined;
  occurrenceCode?: string | undefined;
  occurrenceDescription?: string | undefined;
  occurrenceDate?: string | undefined;
  reportGeneratedAt?: string | undefined;
  /** 108 cargo details for this NF line; summed or merged per CTC on import. */
  cargoValueCents?: number | undefined;
  weightGrams?: number | undefined;
  nature?: string | undefined;
  city?: string | undefined;
};
type Field = "ctc" | "nf" | "volumes" | "client" | "recipient";
const labels: Record<Field, string> = {
  ctc: "CTC",
  nf: "NF-série",
  volumes: "Volumes",
  client: "Cliente / laboratório",
  recipient: "Destinatário",
};
const patterns: Record<Field, RegExp> = {
  ctc: /\bctcs?\b/i,
  nf: /\bnf(?:-e)?\b|nota(?:s)?\s+fisc|serie/i,
  volumes: /volumes?|\bvols?\b/i,
  client: /cliente|client|laboratorio|remetente/i,
  recipient: /destinatario|recipient/i,
};

function reviewFields(message: string): Field[] {
  // A CTC number following "no CTC" identifies the row, not a faulty CTC cell.
  const text = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bno\s+CTC\s+\d*/gi, "");
  const fields = Object.keys(patterns) as Field[];
  // Quoted values after a colon can contain words such as CLIENTE or NF.
  // Prefer the warning's field label so those values cannot flag other cells.
  const named = fields.filter((field) => patterns[field].test(text.split(":")[0]!));
  return named.length ? named : fields.filter((field) => patterns[field].test(text));
}

export function ManifestDocumentsEditor({
  rows,
  onChange,
  selectedIndex,
  onSelect,
  disabled,
  hideReviewNotice,
  ctcConflicts = {},
  allowStructureChange = true,
}: {
  rows: ManifestDraftRow[];
  onChange: (rows: ManifestDraftRow[]) => void;
  selectedIndex: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
  hideReviewNotice?: string | undefined;
  ctcConflicts?: Record<number, string[]>;
  allowStructureChange?: boolean;
}) {
  const id = useId();
  const index = Math.max(0, Math.min(selectedIndex, rows.length - 1));
  const row = rows[index];
  const isFlagged = (item: ManifestDraftRow, i: number) =>
    !!item.review?.length || !!ctcConflicts[i]?.length;
  const flagged = rows.filter(isFlagged).length;
  if (!row) return null;
  const conflicts = [...new Set(ctcConflicts[index] ?? [])];
  const messages = row.review?.filter((message) => message !== hideReviewNotice) ?? [];
  const issues = Object.fromEntries(
    (Object.keys(patterns) as Field[]).map((field) => [
      field,
      [...new Set(messages.filter((message) => reviewFields(message).includes(field)))],
    ]),
  ) as Record<Field, string[]>;
  const otherIssues = messages.filter((message) => !reviewFields(message).length);
  const warning = (field: Field) =>
    field === "ctc" && conflicts.length ? (
      <span
        className="import-field-warning import-field-conflict"
        id={`${id}-ctc-conflict`}
        role="status"
      >
        <AlertCircle size={13} aria-hidden="true" />
        <span>
          <strong>CTC repetido</strong>
          {conflicts.map((message) => (
            <span key={message}>{message}</span>
          ))}
        </span>
      </span>
    ) : (
      !!issues[field].length && (
        <span className="import-field-warning" id={`${id}-${field}-review`} role="status">
          <AlertCircle size={13} aria-hidden="true" />
          <span>
            <strong>Confira na foto</strong>
            {issues[field].map((message) => (
              <span key={message}>{message}</span>
            ))}
          </span>
        </span>
      )
    );
  return (
    <section className="import-ctc-editor">
      <div className="import-section-title">
        <span>2</span>
        <h4>CTCs esperados</h4>
        <span className="import-ctc-count">
          {rows.length} {rows.length === 1 ? "documento" : "documentos"}
        </span>
        {flagged > 0 && <span className="import-review-count">{flagged} a conferir</span>}
      </div>
      <div className="import-ctc-navigation">
        {rows.length > 1 ? (
          <label className="form-field import-ctc-select">
            CTC {index + 1} de {rows.length}
            <select
              aria-label="Selecionar CTC"
              disabled={disabled}
              value={index}
              onChange={(event) => onSelect(Number(event.target.value))}
            >
              {rows.map((item, i) => (
                <option key={i} value={i}>
                  {i + 1}. {item.ctc || "Novo CTC"}
                  {item.nf ? ` · NF ${item.nf}` : ""}
                  {ctcConflicts[i]?.length
                    ? " · Duplicado"
                    : item.review?.length
                      ? " · Conferir"
                      : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="import-single-ctc">
            CTC 1 de 1<span>Dados do documento</span>
          </div>
        )}
        {rows.length > 1 && (
          <div className="import-ctc-arrows">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || index === 0}
              onClick={() => onSelect(index - 1)}
            >
              <ChevronLeft />
              <span>CTC anterior</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || index === rows.length - 1}
              onClick={() => onSelect(index + 1)}
            >
              <span>Próximo CTC</span>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <div className="import-ctc-fields">
        {(["ctc", "nf", "volumes"] as const).map((field) => (
          <label
            className="form-field"
            data-review={!!issues[field].length}
            data-conflict={field === "ctc" && !!conflicts.length}
            key={field}
          >
            {labels[field]}
            <input
              aria-label={labels[field]}
              aria-invalid={field === "ctc" && conflicts.length ? true : undefined}
              aria-describedby={
                field === "ctc" && conflicts.length
                  ? `${id}-ctc-conflict`
                  : issues[field].length
                    ? `${id}-${field}-review`
                    : undefined
              }
              required={field !== "nf"}
              disabled={disabled}
              value={row[field]}
              inputMode={field === "nf" ? "text" : "numeric"}
              placeholder={field === "ctc" ? "10 dígitos" : field === "nf" ? "Número-série" : "1"}
              maxLength={field === "ctc" ? 10 : undefined}
              type={field === "volumes" ? "number" : "text"}
              min={field === "volumes" ? 1 : undefined}
              step={field === "volumes" ? 1 : undefined}
              onChange={(event) =>
                onChange(
                  rows.map((item, i) =>
                    i === index ? { ...item, [field]: event.target.value } : item,
                  ),
                )
              }
            />
            {warning(field)}
          </label>
        ))}
        {allowStructureChange && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="import-remove-ctc"
            aria-label="Remover CTC"
            title="Remover este CTC"
            disabled={disabled || rows.length === 1}
            onClick={() => {
              onChange(rows.filter((_, i) => i !== index));
              onSelect(Math.max(0, index - 1));
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <div className="import-client-fields">
        {(["client", "recipient"] as const).map((field) => (
          <label className="form-field" data-review={!!issues[field].length} key={field}>
            {field === "client" ? "Cliente / laboratório (remetente)" : labels[field]}
            <input
              aria-label={labels[field]}
              aria-describedby={issues[field].length ? `${id}-${field}-review` : undefined}
              disabled={disabled}
              value={row[field] ?? ""}
              placeholder={
                field === "client" ? "Nome impresso no documento" : "Nome do destinatário"
              }
              onChange={(event) =>
                onChange(
                  rows.map((item, i) =>
                    i === index ? { ...item, [field]: event.target.value } : item,
                  ),
                )
              }
            />
            {warning(field)}
          </label>
        ))}
      </div>
      {!!otherIssues.length && (
        <div className="import-inline-review" role="status">
          <AlertCircle size={14} aria-hidden="true" />
          <span>
            {otherIssues.map((message) => (
              <span key={message}>{message}</span>
            ))}
          </span>
        </div>
      )}
      <div className="import-ctc-bottom">
        {allowStructureChange && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onChange([...rows, { ctc: "", nf: "", volumes: "1" }]);
              onSelect(rows.length);
            }}
          >
            <Plus />
            Adicionar CTC
          </Button>
        )}
        {flagged > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const next = rows.findIndex((item, i) => i > index && isFlagged(item, i));
              onSelect(next >= 0 ? next : rows.findIndex(isFlagged));
            }}
          >
            Ir para campo sinalizado
            <ChevronRight size={14} />
          </Button>
        )}
      </div>
    </section>
  );
}
