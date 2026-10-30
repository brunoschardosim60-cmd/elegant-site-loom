import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Images,
  Loader2,
  Plus,
  RotateCw,
  ScanLine,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { ManifestDocumentsEditor } from "./manifest-documents-editor";
import type { Manifest } from "@/lib/conference";
import { reviewManifestTotals } from "@/lib/manifest-review";
import { findImportConflicts, type ImportDraft, type ImportOutcome } from "@/lib/manifest-import";
import type { PhotoFields } from "@/lib/photo-fields";
import { photoFingerprint, uniquePhotoFiles } from "@/lib/photo-files";
import { LOCAL_HEADER_NOTICE, LOCAL_ROW_NOTICE } from "@/lib/local-photo";
import type { FindArchived } from "@/lib/conference-archive";
import { useArchivedManifests } from "@/hooks/use-archived-manifests";

type Draft = ImportDraft & {
  key: string;
  filename: string;
  file?: File;
  url?: string;
  text?: string;
  status: "manual" | "waiting" | "reading" | "read" | "error";
  kind?: "pre" | "dacte" | "unknown";
  message?: string;
  seconds?: number;
  headerReview?: string[] | undefined;
  imageRotation?: PhotoFields["imageRotation"];
  expectedNfs?: number | undefined;
  expectedRows?: number | undefined;
  totalVolumes?: number | undefined;
  edited?: boolean;
  progress?: string;
  readingSource?: "local" | undefined;
};
const blank = (): Draft => ({
  key: crypto.randomUUID(),
  filename: "Cadastro manual",
  status: "manual",
  id: "",
  plate: "",
  driver: "",
  rows: [{ ctc: "", nf: "", volumes: "1" }],
});
const documentCount = (item: Draft) =>
  new Set(item.rows.map((row) => row.ctc.trim()).filter((ctc) => /^\d{10}$/.test(ctc))).size;
const volumeCount = (item: Draft) =>
  item.rows.reduce(
    (sum, row) =>
      sum +
      (Number.isInteger(Number(row.volumes)) && Number(row.volumes) > 0 ? Number(row.volumes) : 0),
    0,
  );
const reviewCount = (item: Draft) => item.rows.filter((row) => row.review?.length).length;
const needsReview = (item: Draft) =>
  reviewManifestTotals(item.rows, item).messages.length > 0 ||
  item.rows.some((row) => !row.ctc || !row.nf || !row.volumes || !row.client || !row.recipient) ||
  item.status === "error" ||
  !!item.headerReview?.some((message) => message !== LOCAL_HEADER_NOTICE) ||
  !!reviewCount(item);
const statusText = (item: Draft) =>
  item.status === "read"
    ? item.readingSource === "local"
      ? needsReview(item)
        ? "Leitura local · campos a conferir"
        : "Leitura local"
      : item.edited
        ? "Ajustado manualmente"
        : needsReview(item)
          ? "Conferir campos"
          : "Leitura concluída"
    : item.status === "error"
      ? "Leitura interrompida"
      : item.status === "reading"
        ? "Lendo documento"
        : item.status === "waiting"
          ? "Aguardando leitura"
          : "Cadastro manual";
const hasManualContent = (item: Draft) =>
  item.id ||
  item.issueDate ||
  item.plate ||
  item.driver ||
  item.rows.some(
    (row) =>
      row.ctc || row.nf || row.client || row.recipient || (row.volumes && row.volumes !== "1"),
  );

export function ManifestImportDialog({
  open,
  onOpenChange,
  manifests,
  onCreate,
  initialId,
  findArchived,
}: {
  initialId?: string;
  findArchived?: FindArchived | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifests: Manifest[];
  onCreate: (drafts: ImportDraft[]) => ImportOutcome;
}) {
  const fieldId = useId();
  const [items, setItems] = useState<Draft[]>([]);
  const currentItems = useRef(items);
  currentItems.current = items;
  const [active, setActive] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previewRotation, setPreviewRotation] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const cancelCurrent = useRef<(() => void) | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    if (open && !items.length) setItems([blank()]);
  }, [open, items.length]);
  useEffect(() => {
    if (open && initialId) {
      const retained = currentItems.current.filter(
        (item) => item.status !== "manual" || hasManualContent(item),
      );
      setItems([...retained, { ...blank(), id: initialId }]);
      setActive(retained.length);
      setSelectedRow(0);
    }
  }, [open, initialId]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
      cancelCurrent.current = null;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  const draft = items[active];
  const archived = useArchivedManifests(findArchived, items);
  const conflictSources = archived.length ? [...manifests, ...archived] : manifests;
  const conflicts = findImportConflicts(conflictSources, items);
  const draftConflicts = conflicts.filter((conflict) => conflict.index === active);
  const manifestConflicts = [
    ...new Set(
      draftConflicts
        .filter((conflict) => conflict.kind === "manifest")
        .map((conflict) => conflict.message),
    ),
  ];
  const ctcConflicts: Record<number, string[]> = {};
  for (const conflict of draftConflicts)
    if (conflict.kind === "ctc" && conflict.row !== undefined)
      (ctcConflicts[conflict.row] ??= []).push(conflict.message);
  const conflictIndices = new Set(conflicts.map((conflict) => conflict.index));
  const manifestConflictNotice = manifestConflicts.length > 0 && (
    <span
      className="import-field-warning import-field-conflict"
      id={`${fieldId}-manifest-conflict`}
      role="status"
    >
      <AlertCircle size={13} aria-hidden="true" />
      <span>
        <strong>Cadastro duplicado</strong>
        {manifestConflicts.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </span>
    </span>
  );
  const update = (change: Partial<Draft>) => {
    setError("");
    setItems((list) =>
      list.map((item, i) =>
        i === active
          ? {
              ...item,
              ...change,
              totalsReviewed: false,
              ...(item.status === "read" ? { edited: true } : {}),
            }
          : item,
      ),
    );
  };
  const selectItem = (index: number) => {
    setActive(index);
    setSelectedRow(0);
    setPreviewRotation(0);
    setError("");
  };
  const releaseUrl = (url?: string) => {
    if (url) {
      URL.revokeObjectURL(url);
      urls.current = urls.current.filter((item) => item !== url);
    }
  };
  function stopReading() {
    generation.current++;
    const abort = controller.current;
    controller.current = null;
    abort?.abort();
    cancelCurrent.current?.();
    cancelCurrent.current = null;
    setBusy(false);
    setPreparingKey(null);
    setProgress("");
    setError("");
    setActive(0);
    setSelectedRow(0);
    setPreviewRotation(0);
    setDragging(false);
  }
  function closeDialog(value: boolean) {
    if (!value) {
      generation.current++;
      cancelCurrent.current = null;
      controller.current?.abort();
      controller.current = null;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
      setItems([]);
      setActive(0);
      setSelectedRow(0);
      setError("");
      setProgress("");
      setBusy(false);
      setPreparingKey(null);
      setDragging(false);
      setPreviewRotation(0);
    }
    onOpenChange(value);
  }
  async function readFiles(input: FileList | File[] | null, detailed = false, replaceKey?: string) {
    if (busy || controller.current) return;
    const selected = Array.from(input ?? []);
    let files = selected.filter((file) => file.type.startsWith("image/"));
    if (!files.length) {
      if (selected.length)
        setError("Envie uma foto em JPG, PNG ou WebP. Arquivos PDF ainda não são aceitos.");
      return;
    }
    const skippedMessage =
      selected.length !== files.length
        ? "Alguns arquivos foram ignorados. Envie fotos em JPG, PNG ou WebP."
        : "";
    setError(skippedMessage);
    setBusy(true);
    setPreparingKey(replaceKey ?? null);
    setSelectedRow(0);
    setPreviewRotation(0);
    const abort = new AbortController();
    controller.current = abort;
    const run = ++generation.current;
    const isCurrent = () =>
      generation.current === run && controller.current === abort && !abort.signal.aborted;
    const retained = new Set<string>();
    const finished = new Set<string>();
    setProgress(replaceKey ? "Preparando a releitura…" : "Verificando fotos repetidas…");
    const previous = items.find((item) => item.key === replaceKey);
    const recoverable = previous?.status === "read" && hasManualContent(previous);
    const preservedMessage =
      "A nova tentativa não melhorou a leitura. Os dados anteriores foram preservados.";
    const preservePrevious = (item: Draft): Draft =>
      previous
        ? {
            ...previous,
            key: item.key,
            filename: item.filename,
            ...(item.file ? { file: item.file } : {}),
            ...(item.url ? { url: item.url } : {}),
            headerReview: [...new Set([...(previous.headerReview ?? []), preservedMessage])],
            message: preservedMessage,
          }
        : item;
    let additions: Draft[] = [];
    try {
      if (!replaceKey) {
        const existing = items.flatMap((item) => (item.file ? [item.file] : []));
        const registered = manifests.flatMap((manifest) =>
          (manifest.sourcePhotoHashes ?? []).map((hash) => ({ hash, manifestId: manifest.id })),
        );
        const unique = await uniquePhotoFiles(files, existing, abort.signal, registered);
        if (!isCurrent()) return;
        files = unique.files;
        const registeredDuplicates = unique.registeredDuplicates ?? [];
        const repeated = unique.duplicates - registeredDuplicates.length;
        const registeredMessages = [
          ...new Set(
            registeredDuplicates.map(({ filename, manifestId }) => {
              const driver = manifests.find((manifest) => manifest.id === manifestId)?.driver;
              return `${filename}: foto já cadastrada no pré ${manifestId}${driver ? ` · ${driver}` : ""}. Não foi lida novamente.`;
            }),
          ),
        ];
        setError(
          [
            skippedMessage,
            repeated > 0 ? `${repeated} foto(s) repetida(s) ignorada(s).` : "",
            ...registeredMessages,
          ]
            .filter(Boolean)
            .join(" "),
        );
        if (!files.length) return;
      }
      const sourceHashes = await Promise.all(files.map((file) => photoFingerprint(file)));
      if (!isCurrent()) return;
      setPreparingKey(null);
      additions = files.map((file, index) => {
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        const item: Draft = {
          ...(previous ?? blank()),
          key: crypto.randomUUID(),
          file,
          filename: file.name,
          url,
          status: "waiting",
          rows: previous?.rows ?? [{ ctc: "", nf: "", volumes: "" }],
          headerReview: undefined,
          readingSource: undefined,
          edited: false,
        };
        delete item.sourcePhotoHash;
        const hash = sourceHashes[index];
        if (hash) item.sourcePhotoHash = hash;
        return item;
      });
      if (previous) releaseUrl(previous.url);
      cancelCurrent.current = () => {
        const keys = new Set(additions.map((item) => item.key));
        if (!recoverable)
          additions
            .filter((item) => !retained.has(item.key))
            .forEach((item) => releaseUrl(item.url));
        setItems((list) =>
          list.flatMap((item) =>
            !keys.has(item.key)
              ? [item]
              : retained.has(item.key)
                ? [
                    {
                      ...item,
                      status: item.status,
                    },
                  ]
                : recoverable
                  ? [preservePrevious(item)]
                  : [],
          ),
        );
      };
      const keep = currentItems.current.filter(
        (item) => item.key !== replaceKey && (item.status !== "manual" || hasManualContent(item)),
      );
      const previousIndex = replaceKey
        ? currentItems.current.findIndex((item) => item.key === replaceKey)
        : -1;
      const position =
        previousIndex < 0
          ? keep.length
          : currentItems.current
              .slice(0, previousIndex)
              .filter((item) => item.status !== "manual" || hasManualContent(item)).length;
      setItems([...keep.slice(0, position), ...additions, ...keep.slice(position)]);
      setActive(position);
      const { readPrePhotos } = await import("@/lib/photo-ocr");
      if (!isCurrent()) return;
      await readPrePhotos(
        files,
        (index, result) => {
          if (!isCurrent()) return;
          const key = additions[index]!.key;
          if (finished.has(key)) return;
          retained.add(key);
          finished.add(key);
          setItems((list) =>
            list.map((item) => {
              if (item.key !== key) return item;
              if ("error" in result)
                return recoverable
                  ? preservePrevious(item)
                  : { ...item, status: "error", message: result.error };
              // A reread that finds fewer valid CTCs must not discard the earlier
              // reading or the corrections made to it.
              const validCtcCount = result.pre.documents.length
                ? result.pre.documents.filter((row) => /^\d{10}$/.test(row.ctc)).length
                : result.pre.ctcs.filter((ctc) => /^\d{10}$/.test(ctc)).length;
              if (
                recoverable &&
                validCtcCount < previous.rows.filter((row) => /^\d{10}$/.test(row.ctc)).length
              )
                return preservePrevious(item);
              return {
                ...item,
                id: result.pre.id || item.id,
                issueDate: result.pre.issueDate || item.issueDate,
                plate: result.pre.plate || item.plate,
                driver: result.pre.driver || item.driver,
                kind: result.pre.kind,
                status: "read",
                text: result.text,
                rows: result.pre.documents.length
                  ? result.pre.documents
                  : result.pre.ctcs.length
                    ? result.pre.ctcs.map((ctc) => ({ ctc, nf: "", volumes: "" }))
                    : [{ ctc: "", nf: "", volumes: "" }],
                headerReview: result.pre.headerReview,
                readingSource: "local",
                imageRotation: result.pre.imageRotation,
                expectedNfs: result.pre.expectedNfs,
                expectedRows: result.pre.expectedRows,
                totalVolumes: result.pre.totalVolumes,
                seconds: result.milliseconds / 1000,
                message: result.pre.documents.length
                  ? `${result.pre.documents.length} CTC(s) identificados.`
                  : "Não identifiquei CTCs. Confira a foto e complete os campos.",
              };
            }),
          );
        },
        (index, message) => {
          if (!isCurrent()) return;
          const key = additions[index]!.key;
          if (finished.has(key)) return;
          setProgress(`Foto ${index + 1} de ${files.length} · ${message}`);
          setItems((list) =>
            list.map((item) =>
              item.key === key
                ? {
                    ...item,
                    status: "reading",
                    progress: message,
                  }
                : item,
            ),
          );
        },
        abort.signal,
        detailed,
      );
    } catch {
      if (isCurrent())
        setError(
          additions.length
            ? "Falha ao iniciar o leitor. Suas fotos continuam na lista para tentar novamente."
            : "Não foi possível preparar as fotos. Tente selecioná-las novamente.",
        );
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setPreparingKey(null);
        controller.current = null;
        cancelCurrent.current = null;
        setProgress("");
        setItems((list) =>
          list.map((item) =>
            item.status === "waiting" || item.status === "reading"
              ? recoverable && additions.some((addition) => addition.key === item.key)
                ? preservePrevious(item)
                : {
                    ...item,
                    status: "error",
                    message: "Leitura interrompida. Tente ler esta foto novamente.",
                  }
              : item,
          ),
        );
      }
    }
  }
  function save(all: boolean) {
    if (busy) return;
    const conflict = findImportConflicts(conflictSources, items).find(
      (item) => all || item.index === active,
    );
    if (conflict) {
      setActive(conflict.index);
      setSelectedRow(conflict.row ?? 0);
      setError("");
      return;
    }
    const chosen = all ? items : draft ? [draft] : [];
    const blockedTotals = chosen.findIndex((item) => reviewManifestTotals(item.rows, item).blocked);
    if (blockedTotals >= 0) {
      setActive(all ? blockedTotals : active);
      setError(
        "Os totais diferem do cabeçalho. Corrija os campos ou confirme a revisão dos totais antes de cadastrar.",
      );
      return;
    }
    const result = onCreate(chosen);
    if (!result.ok) {
      setError(result.error);
      setActive(all ? result.index : active);
      setSelectedRow(result.row ?? 0);
      return;
    }
    const keys = new Set(chosen.map((item) => item.key));
    chosen.forEach((item) => releaseUrl(item.url));
    const remaining = items.filter((item) => !keys.has(item.key));
    setItems(remaining);
    setActive(0);
    setSelectedRow(0);
    setPreviewRotation(0);
    setError("");
    if (!remaining.length) closeDialog(false);
  }
  const waiting = draft?.status === "waiting" || draft?.status === "reading";
  const fieldsDisabled = waiting || draft?.key === preparingKey;
  const filled =
    draft?.rows.filter(
      (row) => row.ctc && row.nf && Number(row.volumes) > 0 && row.client && row.recipient,
    ).length ?? 0;
  const photoCount = items.filter((item) => item.file).length;
  const completed = items.filter(
    (item) => item.status === "read" || item.status === "error",
  ).length;
  const detected = items.reduce((sum, item) => sum + documentCount(item), 0);
  const volumes = items.reduce((sum, item) => sum + volumeCount(item), 0);
  const locked = busy;
  const headerMessages =
    draft?.headerReview?.filter((message) => message !== LOCAL_HEADER_NOTICE) ?? [];
  const ctcTotalMismatch = !!draft?.expectedRows && draft.expectedRows !== documentCount(draft);
  const nfCount = draft ? reviewManifestTotals(draft.rows, draft).nfs : 0;
  const nfTotalMismatch = !!draft?.expectedNfs && draft.expectedNfs !== nfCount;
  const volumeTotalMismatch = !!draft?.totalVolumes && draft.totalVolumes !== volumeCount(draft);
  const targets = [
    ...manifests.map((item) => ({ id: item.id, driver: item.driver })),
    ...items
      .filter((item) => item.kind === "pre" && item.id && !manifests.some((m) => m.id === item.id))
      .map((item) => ({ id: item.id, driver: item.driver })),
  ];
  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="import-dialog">
        <DialogHeader className="import-header">
          <div className="import-heading-icon">
            <ScanLine size={23} />
          </div>
          <div>
            <span className="import-eyebrow">Entrada de documentos</span>
            <DialogTitle>Importar pré-manifestos</DialogTitle>
            <DialogDescription>
              Uma foto ou um lote inteiro. Acompanhe a leitura e confira os dados antes de
              cadastrar.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div
          className="import-toolbar"
          onDragEnter={(event) => {
            event.preventDefault();
            if (!locked) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void readFiles(event.dataTransfer.files);
          }}
          data-dragging={dragging}
        >
          <div className="import-upload-actions">
            <label className="import-upload-card" data-disabled={locked}>
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={locked}
                aria-label="Enviar várias fotos"
                onChange={(event) => {
                  void readFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <UploadCloud size={24} />
              <span>
                <strong>Selecionar fotos</strong>
                <small>Uma ou várias · JPG, PNG, WebP</small>
              </span>
              <Plus size={18} className="import-upload-plus" />
            </label>
            <label className="import-camera-card" data-disabled={locked}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={locked}
                aria-label="Tirar foto"
                onChange={(event) => {
                  void readFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <Camera size={21} />
              <span>Tirar foto</span>
            </label>
          </div>
          <div className="import-reader-settings">
            <span className="import-reader-badge">
              <span className="import-dot" />
              Leitura local
            </span>
            <details>
              <summary>Sobre a leitura</summary>
              <div className="import-reader-options">
                <p>
                  As fotos são lidas no próprio navegador e não são enviadas a nenhum serviço
                  externo. Campos vazios ou incertos ficam sinalizados individualmente; revise os
                  dados antes de cadastrar.
                </p>
              </div>
            </details>
          </div>
          {dragging && (
            <div className="import-drop-overlay">
              <Images size={30} />
              <strong>Solte as fotos para ler</strong>
            </div>
          )}
        </div>
        {busy && (
          <div role="status" className="import-progress">
            <Loader2 className="animate-spin" size={18} />
            <div>
              <strong>{progress || "Preparando suas fotos…"}</strong>
              <span>
                {completed} de {photoCount} fotos processadas. Você pode conferir as que já
                terminaram.
              </span>
              <div
                className="import-progress-track"
                role="progressbar"
                aria-label="Fotos processadas"
                aria-valuemin={0}
                aria-valuemax={photoCount}
                aria-valuenow={completed}
              >
                <i style={{ width: `${photoCount ? (completed / photoCount) * 100 : 0}%` }} />
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={stopReading}>
              Parar
            </Button>
          </div>
        )}
        <div className="import-body">
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
                  onChange={(event) => selectItem(Number(event.target.value))}
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
                  onClick={() => selectItem(index)}
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
              onClick={() => {
                setItems((list) => [...list, blank()]);
                selectItem(items.length);
              }}
            >
              <Plus size={15} />
              Adicionar pré manualmente
            </Button>
            <p className="import-draft-note">
              Os documentos só serão salvos ao cadastrar. Fechar descarta os rascunhos e as fotos.
            </p>
          </aside>
          {draft && (
            <form
              className="import-review"
              noValidate
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                save(false);
              }}
            >
              <div className="import-review-heading">
                <div>
                  <span className="import-eyebrow">
                    Documento {active + 1} de {items.length}
                  </span>
                  <h3>
                    {draft.id ||
                      (draft.kind === "dacte"
                        ? "Documento avulso (DACTE)"
                        : draft.file
                          ? waiting
                            ? "Lendo seu documento"
                            : "Informe o número do pré"
                          : "Preencha os dados do pré")}
                  </h3>
                  <p>
                    {draft.file ? draft.filename : "Cadastre os documentos sem enviar uma foto."}
                  </p>
                </div>
                <span
                  className={`import-file-status ${draftConflicts.length || needsReview(draft) ? "warning" : draft.status === "read" ? "success" : ""}`}
                >
                  {draftConflicts.length ? (
                    <AlertCircle />
                  ) : fieldsDisabled ? (
                    <Loader2 className="animate-spin" />
                  ) : draft.status === "read" ? (
                    <CheckCircle2 />
                  ) : null}
                  {draftConflicts.length ? "Cadastro duplicado" : statusText(draft)}
                </span>
              </div>
              {error && (
                <div className="import-alert error" role="alert">
                  <AlertCircle size={18} />
                  <div>
                    <strong>Confira antes de cadastrar</strong>
                    <p>{error}</p>
                  </div>
                </div>
              )}
              {draft.status === "error" && (
                <div className="import-alert error" role="alert">
                  <AlertCircle size={18} />
                  <div>
                    <strong>Não foi possível concluir esta foto</strong>
                    <p>{draft.message}</p>
                  </div>
                </div>
              )}
              {draft.readingSource === "local" ? (
                <div
                  className={`import-alert ${needsReview(draft) ? "warning" : "local"}`}
                  role="status"
                >
                  <AlertCircle size={19} />
                  <div>
                    <strong>Leitura local</strong>
                    <p>
                      Leitura feita no navegador. Revise os dados antes de cadastrar; campos
                      incertos estão sinalizados.
                    </p>
                    {headerMessages.map((message) => (
                      <p key={message}>{message}</p>
                    ))}
                  </div>
                </div>
              ) : (
                !!headerMessages.length && (
                  <div className="import-alert warning" role="status">
                    <AlertCircle size={18} />
                    <div>
                      <strong>Conferir os dados do pré</strong>
                      {headerMessages.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </div>
                  </div>
                )
              )}
              <div className={`import-review-columns ${draft.url ? "with-photo" : ""}`}>
                <section className="import-details-panel">
                  <div className="import-section-title">
                    <span>1</span>
                    <h4>Dados do pré</h4>
                  </div>
                  {draft.kind === "dacte" && (
                    <label
                      className="form-field import-target"
                      data-conflict={!!draft.targetId && !!manifestConflicts.length}
                    >
                      DACTE avulso — vincular ao pré
                      <select
                        aria-label="Vincular DACTE ao pré"
                        aria-invalid={draft.targetId && manifestConflicts.length ? true : undefined}
                        aria-describedby={
                          draft.targetId && manifestConflicts.length
                            ? `${fieldId}-manifest-conflict`
                            : undefined
                        }
                        disabled={fieldsDisabled}
                        value={draft.targetId || ""}
                        onChange={(event) => update({ targetId: event.target.value })}
                      >
                        <option value="">Selecione um pré ou preencha abaixo</option>
                        {targets.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.id} · {item.driver}
                          </option>
                        ))}
                      </select>
                      {draft.targetId && manifestConflictNotice}
                    </label>
                  )}
                  {!draft.targetId && (
                    <div className="import-manifest-fields">
                      <label className="form-field" data-conflict={!!manifestConflicts.length}>
                        Número do pré
                        <input
                          aria-label="Número do pré"
                          aria-invalid={manifestConflicts.length ? true : undefined}
                          aria-describedby={
                            manifestConflicts.length ? `${fieldId}-manifest-conflict` : undefined
                          }
                          disabled={fieldsDisabled}
                          value={draft.id}
                          placeholder="DI00000000000"
                          onChange={(event) => update({ id: event.target.value })}
                        />
                        {manifestConflictNotice}
                      </label>
                      <label className="form-field">
                        Data de emissão do pré
                        <input
                          aria-label="Data de emissão do pré"
                          type="date"
                          disabled={fieldsDisabled}
                          value={draft.issueDate ?? ""}
                          onChange={(event) => update({ issueDate: event.target.value })}
                        />
                      </label>
                      <label className="form-field">
                        Placa
                        <input
                          aria-label="Placa"
                          disabled={fieldsDisabled}
                          value={draft.plate}
                          maxLength={8}
                          placeholder="ABC1D23"
                          onChange={(event) => update({ plate: event.target.value })}
                        />
                      </label>
                      <label className="form-field">
                        Motorista
                        <input
                          aria-label="Motorista"
                          disabled={fieldsDisabled}
                          value={draft.driver}
                          placeholder="Nome do motorista"
                          onChange={(event) => update({ driver: event.target.value })}
                        />
                      </label>
                    </div>
                  )}
                  {!draft.targetId && (
                    <p className="import-date-note">
                      Use a data impressa no cabeçalho do pré para contar os dias pendentes. Se não
                      estiver legível, deixe em branco.
                    </p>
                  )}
                  {draft.status === "read" && (
                    <div
                      className="import-document-totals"
                      role="group"
                      aria-label="Totais da foto"
                    >
                      <span data-mismatch={ctcTotalMismatch}>
                        <strong>
                          {documentCount(draft)}
                          {draft.expectedRows != null &&
                          draft.expectedRows > 0 &&
                          draft.expectedRows !== documentCount(draft)
                            ? ` / ${draft.expectedRows}`
                            : ""}
                        </strong>{" "}
                        CTCs lidos{ctcTotalMismatch && <small>Confira a contagem</small>}
                      </span>
                      <span data-mismatch={volumeTotalMismatch}>
                        <strong>
                          {volumeCount(draft)}
                          {draft.totalVolumes != null &&
                          draft.totalVolumes > 0 &&
                          draft.totalVolumes !== volumeCount(draft)
                            ? ` / ${draft.totalVolumes}`
                            : ""}
                        </strong>{" "}
                        volumes{volumeTotalMismatch && <small>Confira a soma</small>}
                      </span>
                      {draft.expectedNfs !== undefined && (
                        <span data-mismatch={nfTotalMismatch}>
                          <strong>
                            {nfCount}
                            {nfTotalMismatch ? ` / ${draft.expectedNfs}` : ""}
                          </strong>{" "}
                          NFs{nfTotalMismatch && <small>Confira as NFs</small>}
                        </span>
                      )}
                      {draft.seconds !== undefined && (
                        <span>
                          <strong>{draft.seconds.toFixed(1)} s</strong> de leitura
                        </span>
                      )}
                    </div>
                  )}
                  {(ctcTotalMismatch || volumeTotalMismatch || nfTotalMismatch) && (
                    <div
                      role="alert"
                      className="rounded-lg border border-amber-300 bg-amber-50 p-3 mt-3 text-xs space-y-2"
                    >
                      {reviewManifestTotals(draft.rows, draft).messages.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          aria-label="Confirmar revisão dos totais"
                          checked={!!draft.totalsReviewed}
                          disabled={fieldsDisabled}
                          onChange={(event) =>
                            setItems((list) =>
                              list.map((item, i) =>
                                i === active
                                  ? { ...item, totalsReviewed: event.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                        Conferi a foto e confirmo cadastrar com estes totais diferentes.
                      </label>
                    </div>
                  )}
                </section>
                {draft.url && (
                  <section className="import-photo-panel">
                    <div className="import-photo-heading">
                      <span>Foto original</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Girar visualização da foto"
                        title="Girar visualização da foto"
                        onClick={() => setPreviewRotation((value) => (value + 90) % 360)}
                      >
                        <RotateCw size={15} />
                      </Button>
                    </div>
                    <a
                      href={draft.url}
                      target="_blank"
                      rel="noreferrer"
                      className="import-photo-frame"
                      aria-label="Ampliar foto original"
                    >
                      <img
                        src={draft.url}
                        style={{ transform: `rotate(${previewRotation}deg)` }}
                        alt="Documento enviado para conferência"
                      />
                    </a>
                    <span className="import-photo-caption">Toque na foto para ampliar</span>
                  </section>
                )}
              </div>
              {waiting ? (
                <div className="import-reading-placeholder" role="status">
                  <ScanLine
                    size={30}
                    className={draft.status === "reading" ? "animate-pulse" : ""}
                  />
                  <strong>
                    {draft.status === "waiting"
                      ? "Esta foto está na fila"
                      : "Lendo todas as linhas do documento"}
                  </strong>
                  <p>
                    {draft.status === "waiting"
                      ? "As fotos prontas já podem ser conferidas na lista."
                      : "CTCs, notas fiscais, volumes e clientes aparecerão aqui."}
                  </p>
                </div>
              ) : (
                <>
                  <ManifestDocumentsEditor
                    rows={draft.rows}
                    onChange={(rows) => update({ rows })}
                    selectedIndex={selectedRow}
                    onSelect={setSelectedRow}
                    disabled={fieldsDisabled}
                    hideReviewNotice={
                      draft.readingSource === "local" ? LOCAL_ROW_NOTICE : undefined
                    }
                    ctcConflicts={ctcConflicts}
                  />
                  {draft.status === "read" && (
                    <p className="import-completeness" role="status">
                      {filled} de {draft.rows.length} linha(s) com NF, volumes, cliente e
                      destinatário preenchidos.
                      {reviewCount(draft) > 0 &&
                        ` ${reviewCount(draft)} CTC(s) com campos para conferir.`}
                    </p>
                  )}
                </>
              )}
              {draft.file && !waiting && (
                <div className="import-read-tools">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void readFiles([draft.file!], true, draft.key);
                    }}
                  >
                    <ScanLine size={15} />
                    {draft.status === "error"
                      ? "Tentar ler novamente"
                      : "Reler detalhes desta foto"}
                  </Button>
                  {draft.text && (
                    <details className="import-raw-text">
                      <summary>Texto identificado</summary>
                      <textarea readOnly aria-label="Texto lido da foto" value={draft.text} />
                    </details>
                  )}
                </div>
              )}
              <div className="import-form-footer">
                <div className="import-footer-info">
                  <span>
                    {documentCount(draft)} CTCs · {volumeCount(draft)} volumes
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      releaseUrl(draft.url);
                      setItems((list) => list.filter((item) => item.key !== draft.key));
                      selectItem(Math.max(0, active - 1));
                    }}
                  >
                    <Trash2 size={14} />
                    {draft.file ? "Remover foto" : "Remover pré"}
                  </Button>
                </div>
                <div className="import-save-actions">
                  <Button
                    type="submit"
                    variant={items.length > 1 ? "outline" : "default"}
                    disabled={busy || waiting || !!draftConflicts.length}
                  >
                    {draft.targetId ? "Adicionar ao pré" : "Cadastrar pré"}
                  </Button>
                  {items.length > 1 && (
                    <Button
                      type="button"
                      disabled={busy || !!conflicts.length}
                      onClick={() => save(true)}
                    >
                      Cadastrar lote ({items.length})
                    </Button>
                  )}
                </div>
              </div>
              {items.length > 1 && (
                <div className="import-file-navigation">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={active === 0}
                    onClick={() => selectItem(active - 1)}
                  >
                    <ChevronLeft size={15} />
                    Documento anterior
                  </Button>
                  <span>
                    {active + 1} / {items.length}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={active === items.length - 1}
                    onClick={() => selectItem(active + 1)}
                  >
                    Próximo documento
                    <ChevronRight size={15} />
                  </Button>
                </div>
              )}
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
