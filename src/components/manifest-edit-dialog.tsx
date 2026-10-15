import { isExportManifest } from "@/lib/manifest-id";
import { useState } from "react";
import type { Manifest } from "@/lib/conference";
import type { ImportDraft, ImportOutcome } from "@/lib/manifest-import";
import { reviewManifestTotals } from "@/lib/manifest-review";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { ManifestDocumentsEditor } from "./manifest-documents-editor";

export function ManifestEditDialog({
  manifest,
  onClose,
  onSave,
}: {
  manifest: Manifest;
  onClose: () => void;
  onSave: (base: Manifest, draft: ImportDraft) => ImportOutcome;
}) {
  const [draft, setDraft] = useState<ImportDraft>(() => ({
    ...manifest,
    rows: manifest.documents.map((doc) => ({
      ctc: doc.ctc,
      nf: doc.nf === "—" ? "" : doc.nf,
      volumes: String(doc.volumes),
      client: doc.client ?? "",
      recipient: doc.recipient ?? "",
    })),
  }));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const update = (patch: Partial<ImportDraft>) => {
    setError("");
    setDraft((value) => ({ ...value, ...patch, totalsReviewed: false }));
  };
  const labels = isExportManifest(manifest.id)
    ? ["Número do manifesto", "Data de emissão do manifesto", "Placa", "Motorista"]
    : ["Número do pré", "Data de emissão do pré", "Placa", "Motorista"];
  const totals = reviewManifestTotals(draft.rows, draft);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="manifest-edit-dialog max-w-3xl max-h-[90dvh] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="manifest-edit-header shrink-0 border-b px-6 py-5 pr-10 text-left">
          <DialogTitle>
            {isExportManifest(manifest.id) ? "Editar manifesto" : "Editar pré-manifesto"}
          </DialogTitle>
          <DialogDescription>
            Corrija os dados. As conferências, horários e o histórico são preservados. Para corrigir
            um CTC recebido, desfaça a conferência primeiro.
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-h-0 flex-1 flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const result = onSave(manifest, draft);
            if (result.ok) onClose();
            else {
              setError(result.error);
              setSelected(result.row ?? 0);
            }
          }}
        >
          <div className="manifest-edit-body min-h-0 flex-1 overflow-y-auto p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["id", "issueDate", "plate", "driver"] as const).map((field, index) => (
                <label className="form-field" key={field}>
                  {labels[index]}
                  <input
                    aria-label={labels[index]}
                    type={field === "issueDate" ? "date" : "text"}
                    required={field !== "issueDate"}
                    value={draft[field] ?? ""}
                    onChange={(event) => update({ [field]: event.target.value })}
                  />
                </label>
              ))}
            </div>
            <details>
              <summary className="text-xs cursor-pointer">Totais impressos no cabeçalho</summary>
              <div className="grid grid-cols-2 gap-3 mt-3">
                {(["expectedRows", "totalVolumes"] as const).map((field, index) => (
                  <label className="form-field" key={field}>
                    {["CTCs no cabeçalho", "Volumes no cabeçalho"][index]}
                    <input
                      aria-label={["CTCs no cabeçalho", "Volumes no cabeçalho"][index]}
                      type="number"
                      min="1"
                      step="1"
                      value={draft[field] ?? ""}
                      onChange={(event) =>
                        update({
                          [field]: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <ManifestDocumentsEditor
              rows={draft.rows}
              onChange={(rows) => update({ rows })}
              selectedIndex={selected}
              onSelect={setSelected}
              allowStructureChange={false}
            />
            <p className="text-xs">
              {totals.ctcs} CTCs · {totals.volumes} volumes
            </p>
            {!!totals.messages.length && (
              <div
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-2"
              >
                {totals.messages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={!!draft.totalsReviewed}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, totalsReviewed: event.target.checked }))
                    }
                  />
                  Conferi o documento e confirmo salvar com estes totais diferentes.
                </label>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="manifest-edit-footer shrink-0 border-t px-6 py-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={totals.blocked}>
              Salvar alterações
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
