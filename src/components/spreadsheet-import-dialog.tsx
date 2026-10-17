import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Check,
  FilterX,
  RefreshCw,
  FileSpreadsheet,
  Loader2,
  Search,
  UploadCloud,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import type { Manifest } from "@/lib/conference";
import { findImportConflicts, type ImportDraft, type ImportOutcome } from "@/lib/manifest-import";
import { findLuftCtcOverlaps, luftManifestDays, type LuftExport } from "@/lib/luft-spreadsheet";
import { formatManifestDate } from "@/lib/manifest-date";
import { isAnotherRoute } from "@/lib/conference-routes";
import { planOccurrenceUpdates } from "@/lib/nf-occurrences";

export function SpreadsheetImportDialog({
  manifests,
  onClose,
  onCreate,
  onUpdateOccurrences,
}: {
  manifests: Manifest[];
  onClose: () => void;
  onCreate: (drafts: ImportDraft[]) => ImportOutcome;
  onUpdateOccurrences?: (drafts: ImportDraft[]) => ImportOutcome;
}) {
  const [result, setResult] = useState<LuftExport | null>(null);
  const [filename, setFilename] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const [query, setQuery] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  function stop() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }
  function close() {
    stop();
    onClose();
  }
  function dragFile(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = busy ? "none" : "copy";
    if (event.type === "dragenter" && !busy) {
      dragDepth.current++;
      setDragging(true);
    }
  }
  function leaveFile(event: DragEvent<HTMLElement>) {
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  }
  function dropFile(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      setError("Solte apenas uma planilha XLSX por vez.");
      return;
    }
    void load(files[0]);
  }
  async function load(file?: File) {
    if (!file) return;
    dragDepth.current = 0;
    setDragging(false);
    stop();
    const abort = new AbortController();
    controller.current = abort;
    setStopped(false);
    setBusy(true);
    setError("");
    setUpdateMessage("");
    setResult(null);
    setSelected(new Set());
    setQuery("");
    setDayFilter("");
    setActive("");
    setFilename(file.name);
    const start = performance.now();
    try {
      const { readLuftSpreadsheet } = await import("@/lib/read-luft-spreadsheet");
      if (abort.signal.aborted) return;
      const parsed = await readLuftSpreadsheet(file, abort.signal);
      if (abort.signal.aborted || controller.current !== abort) return;
      setResult(parsed);
      setSeconds((performance.now() - start) / 1000);
      const overlaps = new Set(
        findLuftCtcOverlaps(parsed.drafts).flatMap((item) => item.manifestIds),
      );
      setSelected(
        new Set(
          parsed.drafts
            .filter(
              (draft) => !overlaps.has(draft.id) && !findImportConflicts(manifests, [draft]).length,
            )
            .map((draft) => draft.id),
        ),
      );
      setActive(parsed.drafts[0]?.id ?? "");
    } catch (cause) {
      if (!abort.signal.aborted && controller.current === abort)
        setError(cause instanceof Error ? cause.message : "Não foi possível ler a planilha.");
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  const drafts = useMemo(() => result?.drafts ?? [], [result]);
  const occurrenceUpdates = useMemo(() => {
    if (!result || result.errors.length) return null;
    try {
      return planOccurrenceUpdates(manifests, drafts);
    } catch {
      return null;
    }
  }, [result, manifests, drafts]);
  const conflicts = useMemo(
    () =>
      drafts.flatMap((draft, index) =>
        findImportConflicts(manifests, [draft]).map((conflict) => ({ ...conflict, index })),
      ),
    [manifests, drafts],
  );
  const overlaps = useMemo(() => findLuftCtcOverlaps(drafts), [drafts]);
  const remanifestations = useMemo(() => {
    const owners = new Map<string, ImportDraft[]>();
    for (const draft of drafts)
      for (const ctc of new Set(draft.rows.map((row) => row.ctc)))
        owners.set(ctc, [...(owners.get(ctc) ?? []), draft]);
    return [...owners].filter(([, routes]) =>
      routes.some((route) => routes.some((other) => isAnotherRoute(route, other))),
    );
  }, [drafts]);
  const blocked = new Set(conflicts.map((conflict) => drafts[conflict.index]?.id));
  const normalized = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  const days = useMemo(() => luftManifestDays(drafts), [drafts]);
  const visible = drafts.filter(
    (draft) =>
      (!dayFilter || draft.issueDate === dayFilter) &&
      normalized(`${draft.driver} ${draft.plate} ${draft.id}`).includes(normalized(query.trim())),
  );
  const chosen = drafts.filter((draft) => selected.has(draft.id));
  const selectionOverlaps = findLuftCtcOverlaps(chosen);
  const selectedBlocked = chosen.filter((draft) => blocked.has(draft.id)).length;
  const current = drafts.find((draft) => draft.id === active);
  const ctcs = chosen.reduce((sum, draft) => sum + (draft.expectedRows ?? 0), 0);
  const uniqueCtcs = new Set(chosen.flatMap((draft) => draft.rows.map((row) => row.ctc))).size;
  const allUniqueCtcs = new Set(drafts.flatMap((draft) => draft.rows.map((row) => row.ctc))).size;
  const nfs = chosen.reduce((sum, draft) => sum + draft.rows.length, 0);
  const volumes = chosen.reduce((sum, draft) => sum + (draft.totalVolumes ?? 0), 0);
  const canSave =
    !busy &&
    chosen.length > 0 &&
    !result?.errors.length &&
    !selectionOverlaps.length &&
    chosen.every((draft) => !blocked.has(draft.id));
  function chooseManifest(id: string) {
    if (blocked.has(id)) return;
    const others = new Set(
      overlaps
        .filter((item) => item.manifestIds.includes(id))
        .flatMap((item) => item.manifestIds)
        .filter((other) => other !== id),
    );
    setSelected(
      (previous) => new Set([...previous].filter((other) => !others.has(other)).concat(id)),
    );
    setActive(id);
  }
  function save() {
    if (!canSave) return;
    const outcome = onCreate(chosen);
    if (outcome.ok) close();
    else {
      setError(outcome.error);
      setActive(chosen[outcome.index]?.id ?? "");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "none";
          }
        }}
        onDrop={(event) => event.preventDefault()}
        className="sheet-import-dialog w-[calc(100vw-1rem)] max-w-6xl max-h-[94dvh] flex flex-col overflow-hidden p-0"
      >
        <DialogHeader className="sheet-import-header shrink-0 border-b px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-primary/10 p-2.5 text-primary">
              <FileSpreadsheet size={25} />
            </span>
            <div className="min-w-0">
              <DialogTitle>Importar planilha da Luft</DialogTitle>
              <DialogDescription className="mt-1">
                Relatório 108 · Relação de Notas por Manifesto
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="sheet-import-body min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-4">
          <label
            onDragEnter={dragFile}
            onDragOver={dragFile}
            onDragLeave={leaveFile}
            onDrop={dropFile}
            data-dragging={dragging || undefined}
            className={`focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 sheet-upload flex items-center gap-3 rounded-lg border border-dashed p-4 transition-colors ${busy ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-primary/10"} ${dragging ? "border-primary bg-primary/10 ring-2 ring-primary ring-offset-2" : "border-primary/30 bg-primary/5"}`}
          >
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="Enviar planilha 108"
              disabled={busy}
              onChange={(event) => {
                void load(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <UploadCloud size={24} className="shrink-0 text-primary" />
            <span className="min-w-0">
              <strong className="block text-sm">
                {dragging
                  ? "Solte a planilha aqui"
                  : filename || "Arraste a planilha 108 ou clique para selecionar"}
              </strong>
              <span className="text-xs text-muted-foreground">
                XLSX · até 8 MB · Filial 06 + DIS. TRA e outras filiais ficam de fora.
              </span>
            </span>
          </label>
          {busy && (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
              role="status"
            >
              <span className="flex items-center gap-2 text-sm">
                <Loader2 className="animate-spin" size={17} />
                Lendo a planilha no navegador…
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  stop();
                  setStopped(true);
                }}
              >
                Parar
              </Button>
            </div>
          )}
          {stopped && (
            <p role="status" className="rounded-lg border bg-muted/50 p-3 text-sm">
              Leitura interrompida. Nenhum manifesto foi cadastrado. Selecione a planilha para
              tentar novamente.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {!!result?.errors.length && (
            <div
              role="alert"
              className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
            >
              <strong className="flex gap-2 items-center">
                <AlertCircle size={16} />
                Corrija o relatório antes de cadastrar
              </strong>
              <p className="mt-1">
                Há linhas inválidas ou conflitantes na filial 06 / DIS. O lote não será salvo
                parcialmente.
              </p>
              <ul className="mt-2 max-h-32 overflow-auto list-disc pl-5">
                {result.errors.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          {!!overlaps.length && (
            <div
              role="alert"
              className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
            >
              <strong>CTC presente em mais de um manifesto</strong>
              <p className="mt-1">
                Escolha qual manifesto cadastrar. Os envolvidos começam desmarcados; os demais
                continuam selecionados. Cada opção mantém o manifesto inteiro, com todas as suas NFs
                e volumes. Nenhum CTC será retirado ou transferido automaticamente.
              </p>
              <div className="mt-3 max-h-64 overflow-auto space-y-3">
                {overlaps.map((item) => (
                  <div
                    key={item.ctc}
                    className="rounded border border-warning/20 bg-background/70 p-3"
                  >
                    <p className="font-semibold">CTC {item.ctc}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.manifestIds.map((id) => {
                        const draft = drafts.find((candidate) => candidate.id === id);
                        if (!draft) return null;
                        return (
                          <Button
                            key={id}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-auto max-w-full whitespace-normal text-left"
                            aria-pressed={selected.has(id)}
                            disabled={blocked.has(id)}
                            onClick={() => chooseManifest(id)}
                          >
                            <span>
                              <strong className="block">
                                {selected.has(id) ? "Selecionado" : "Selecionar"} {id} ·{" "}
                                {formatManifestDate(draft.issueDate)}
                              </strong>
                              <span className="block text-xs">
                                {draft.driver} · {draft.plate} · {draft.expectedRows} CTCs ·{" "}
                                {draft.totalVolumes} vol.
                              </span>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {!!selectionOverlaps.length && (
                <p className="mt-2 font-semibold">
                  A seleção ainda contém CTCs repetidos. Escolha apenas um manifesto para cada
                  conflito antes de cadastrar.
                </p>
              )}
            </div>
          )}
          {!!remanifestations.length && (
            <div
              role="status"
              className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
            >
              <strong>{remanifestations.length} CTC(s) em novas tentativas de rota</strong>
              <p className="mt-1">
                É normal o mesmo CTC aparecer em dias e motoristas diferentes. Todas as linhas serão
                mantidas; a bipagem confere apenas a rota mais recente cadastrada. As anteriores
                aparecem no rastreamento como remanifestadas.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer font-medium">
                  Ver rotas anteriores e novas
                </summary>
                <ul className="mt-2 max-h-32 overflow-auto space-y-2">
                  {remanifestations.map(([ctc, routes]) => (
                    <li key={ctc}>
                      <strong>CTC {ctc}</strong>
                      {routes.map((route) => (
                        <span className="block text-xs" key={route.id}>
                          {formatManifestDate(route.issueDate)} · {route.id} · {route.driver} ·{" "}
                          {route.plate}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          {result && (
            <>
              <div
                className={`sheet-import-summary border-l-2 pl-4 py-1 text-sm ${result.errors.length ? "border-warning" : "border-success"}`}
                role="status"
              >
                <p className="flex items-center gap-2 font-semibold">
                  {result.errors.length ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{" "}
                  {drafts.length} manifestos em {days.length} {days.length === 1 ? "dia" : "dias"} ·{" "}
                  {seconds.toFixed(1).replace(".", ",")} s
                </p>
                <p className="mt-1 text-muted-foreground">
                  {formatManifestDate(days[0]?.date)} a {formatManifestDate(days.at(-1)?.date)}
                </p>
                <dl className="sheet-import-metrics">
                  {[
                    ["Manifestos", drafts.length],
                    ["CTCs", drafts.reduce((sum, draft) => sum + (draft.expectedRows ?? 0), 0)],
                    ["NFs", drafts.reduce((sum, draft) => sum + draft.rows.length, 0)],
                    ["Volumes", drafts.reduce((sum, draft) => sum + (draft.totalVolumes ?? 0), 0)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {allUniqueCtcs <
                  drafts.reduce((sum, draft) => sum + (draft.expectedRows ?? 0), 0) && (
                  <p className="text-xs text-muted-foreground">
                    {allUniqueCtcs} CTCs únicos entre as rotas
                  </p>
                )}
                <p className="mt-1 text-xs">
                  {result.ignored} linhas de outras filiais ou motivos ignoradas. {result.repeated}{" "}
                  repetições idênticas removidas. Nada foi cadastrado ainda.
                </p>
                <p className="mt-1 text-xs">
                  {
                    drafts
                      .flatMap((draft) => draft.rows)
                      .filter((row) => row.occurrenceCode || row.occurrenceDescription).length
                  }{" "}
                  NFs com última ocorrência informada. Esses dados não alteram a conferência do
                  documento.
                </p>
              </div>
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                aria-label="Resumo por dia de manifesto"
              >
                {days.map((day) => (
                  <Button
                    variant="outline"
                    key={day.date}
                    type="button"
                    aria-pressed={dayFilter === day.date}
                    aria-label={`Mostrar manifestos de ${formatManifestDate(day.date)}`}
                    onClick={() => setDayFilter((old) => (old === day.date ? "" : day.date))}
                    className={`sheet-day shrink-0 h-auto block rounded-lg border px-3 py-2 text-left text-xs ${dayFilter === day.date ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50"}`}
                  >
                    <strong className="block">{formatManifestDate(day.date)}</strong>
                    <span className="block">
                      {day.manifests} man. · {day.ctcs} CTCs · {day.volumes} vol.
                    </span>
                  </Button>
                ))}
              </div>
              {!!occurrenceUpdates?.count && onUpdateOccurrences && (
                <div className="rounded-lg border bg-primary/5 p-3 text-sm space-y-2">
                  <p>
                    <strong>{occurrenceUpdates.count} NF(s)</strong> em{" "}
                    {occurrenceUpdates.manifestIds.length} manifesto(s) já cadastrado(s) têm
                    ocorrências para atualizar.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Mantém a ocorrência mais recente das NFs correspondentes deste arquivo, sem
                    duplicar cadastros nem alterar conferências. Os filtros e a seleção são usados
                    para cadastrar manifestos novos.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const outcome = onUpdateOccurrences(drafts);
                      if (outcome.ok) {
                        setError("");
                        setUpdateMessage(
                          "Ocorrências atualizadas. Confira o status de salvamento da conta.",
                        );
                      } else setError(outcome.error);
                    }}
                  >
                    <RefreshCw size={15} /> Atualizar ocorrências das NFs cadastradas
                  </Button>
                </div>
              )}
              {!!occurrenceUpdates?.skippedOlder && (
                <p role="status" className="text-xs text-muted-foreground">
                  {occurrenceUpdates.skippedOlder} ocorrência(s) antiga(s) ignorada(s). As mais
                  recentes já salvas foram mantidas.
                </p>
              )}
              {!!occurrenceUpdates?.skippedUncertain && (
                <p role="status" className="text-sm text-warning">
                  {occurrenceUpdates.skippedUncertain} ocorrência(s) diferente(s) sem referência
                  suficiente de data ou geração do relatório. Os dados salvos foram mantidos.
                </p>
              )}
              {updateMessage && (
                <p role="status" className="text-sm text-primary">
                  {updateMessage}
                </p>
              )}
              <div className="sheet-import-filters grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="focus-within:ring-2 focus-within:ring-primary flex min-w-0 flex-[2_1_220px] items-center gap-2 rounded-lg border px-3 py-2">
                  <Search size={15} className="text-muted-foreground" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    aria-label="Buscar motorista, placa ou manifesto na planilha"
                    placeholder="Motorista, placa ou manifesto"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <select
                  aria-label="Dia do manifesto"
                  className="rounded-lg border bg-background px-3 py-2 text-sm"
                  value={dayFilter}
                  onChange={(event) => setDayFilter(event.target.value)}
                >
                  <option value="">Todos os dias</option>
                  {days.map((day) => (
                    <option value={day.date} key={day.date}>
                      {formatManifestDate(day.date)}
                    </option>
                  ))}
                </select>
                <div className="sheet-selection-tools flex flex-wrap items-center gap-1 sm:col-span-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSelected(
                        new Set(
                          visible
                            .filter((draft) => !blocked.has(draft.id))
                            .map((draft) => draft.id),
                        ),
                      )
                    }
                  >
                    Selecionar resultados
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                  >
                    Limpar seleção
                  </Button>
                  {(query.trim() || dayFilter) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setDayFilter("");
                      }}
                    >
                      <FilterX size={14} /> Limpar filtros
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Exibindo {visible.length} de {drafts.length} ·{" "}
                {visible.filter((d) => selected.has(d.id)).length} selecionados nesta lista,{" "}
                {chosen.length} no total. Filtros não alteram a seleção. Cadastros repetidos ficam
                bloqueados.
              </p>
              {selectedBlocked > 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
                >
                  <p>
                    {selectedBlocked} manifesto(s) selecionado(s) já cadastrado(s) pela equipe.
                    Remova os repetidos da seleção para continuar.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() =>
                      setSelected(
                        (previous) => new Set([...previous].filter((id) => !blocked.has(id))),
                      )
                    }
                  >
                    Remover repetidos da seleção
                  </Button>
                </div>
              )}
              <div
                role="region"
                aria-label="Lista de manifestos da planilha"
                tabIndex={0}
                className="sheet-manifest-table-wrap max-h-[38dvh] overflow-auto rounded-lg border"
              >
                <table
                  className="sheet-manifest-table w-full text-left text-sm"
                  aria-label="Manifestos da planilha"
                >
                  <thead>
                    <tr>
                      {[
                        "Selecionar",
                        "Manifesto / motorista",
                        "Placa",
                        "Manifestado em",
                        "CTCs",
                        "NFs",
                        "Volumes",
                        "Situação",
                      ].map((label) => (
                        <th className="p-3 font-medium whitespace-nowrap" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((draft) => (
                      <tr
                        className={
                          draft.id === active
                            ? "bg-primary/5"
                            : blocked.has(draft.id)
                              ? "bg-warning-soft"
                              : ""
                        }
                        key={draft.id}
                      >
                        <td data-label="Selecionar" className="border-t p-3">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar manifesto ${draft.id}`}
                            disabled={blocked.has(draft.id) && !selected.has(draft.id)}
                            checked={selected.has(draft.id)}
                            onChange={(event) =>
                              setSelected((old) => {
                                const next = new Set(old);
                                if (event.target.checked) next.add(draft.id);
                                else next.delete(draft.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td data-label="Manifesto / motorista" className="border-t p-3">
                          <Button
                            variant="ghost"
                            type="button"
                            className="sheet-manifest-link h-auto block p-0 text-left hover:bg-transparent hover:underline"
                            aria-label={`Ver NFs do manifesto ${draft.id}`}
                            onClick={() => setActive(draft.id)}
                          >
                            <strong className="block font-mono text-primary">{draft.id}</strong>
                            <span className="block mt-1 min-w-40">{draft.driver}</span>
                          </Button>
                        </td>
                        <td data-label="Placa" className="border-t p-3 font-mono">
                          {draft.plate}
                        </td>
                        <td data-label="Manifestado em" className="border-t p-3 whitespace-nowrap">
                          {formatManifestDate(draft.issueDate)}
                          {draft.issueTime && (
                            <span className="block text-muted-foreground">{draft.issueTime}</span>
                          )}
                        </td>
                        <td data-label="CTCs" className="border-t p-3">
                          {draft.expectedRows}
                        </td>
                        <td data-label="NFs" className="border-t p-3">
                          {draft.rows.length}
                        </td>
                        <td data-label="Volumes" className="border-t p-3">
                          {draft.totalVolumes}
                        </td>
                        <td data-label="Situação" className="border-t p-3 min-w-40">
                          {blocked.has(draft.id) ? (
                            <span className="sheet-row-status text-warning">
                              <AlertCircle size={14} />
                              {conflicts
                                .filter((conflict) => drafts[conflict.index]?.id === draft.id)
                                .slice(0, 1)
                                .map((conflict) => conflict.message)}
                            </span>
                          ) : overlaps.some((item) => item.manifestIds.includes(draft.id)) ? (
                            <span className="sheet-row-status text-warning">
                              <AlertCircle size={14} />
                              CTC em outro manifesto ·{" "}
                              {selected.has(draft.id) ? "selecionado" : "aguarda escolha"}
                            </span>
                          ) : (
                            <span className="sheet-row-status text-success">
                              <CheckCircle2 size={14} /> Pronto para cadastrar
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <p className="p-5 text-center text-sm text-muted-foreground">
                    Nenhum manifesto para esta busca ou dia. Limpe os filtros para ver os demais.
                  </p>
                )}
              </div>
              {current && (
                <details key={current.id} open className="sheet-nf-details border-t pt-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    NFs do manifesto {current.id} · {current.driver}
                  </summary>
                  <div
                    role="region"
                    aria-label="Notas fiscais do manifesto selecionado"
                    tabIndex={0}
                    className="sheet-nfs-wrap mt-3 max-h-64 overflow-auto rounded-lg border"
                  >
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr>
                          {[
                            "CTC",
                            "NF-série",
                            "Volumes",
                            "Remetente",
                            "Destinatário",
                            "Última ocorrência",
                          ].map((label) => (
                            <th key={label} className="p-3 whitespace-nowrap">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {current.rows.map((row, i) => (
                          <tr key={i}>
                            <td className="py-2 pr-4 font-mono whitespace-nowrap">{row.ctc}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">
                              {row.nf}
                              {row.deliveryDate && (
                                <span className="block text-muted-foreground">
                                  Prev. {formatManifestDate(row.deliveryDate)}
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-4">{row.volumes}</td>
                            <td className="py-2 pr-4">{row.client}</td>
                            <td className="py-2">{row.recipient}</td>
                            <td className="py-2 pl-4 min-w-48">
                              {row.occurrenceCode || row.occurrenceDescription ? (
                                <>
                                  <strong>{row.occurrenceCode}</strong>
                                  {row.occurrenceCode && row.occurrenceDescription && " — "}
                                  {row.occurrenceDescription || "Descrição não informada"}
                                </>
                              ) : (
                                <span className="text-muted-foreground">
                                  Não informada na planilha
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              <p className="text-xs text-muted-foreground">
                O número e a data são do manifesto exportado, não do dia da importação. O DI do pré
                não é necessário. NFs do mesmo CTC ficam juntas para uma única conferência.
              </p>
            </>
          )}
        </div>
        <div className="sheet-import-footer shrink-0 border-t px-5 py-3 sm:px-6 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <p className="text-sm" role="status">
            {chosen.length} manifestos em {luftManifestDays(chosen).length}{" "}
            {luftManifestDays(chosen).length === 1 ? "dia" : "dias"} · {ctcs} CTCs · {nfs} NFs ·{" "}
            {volumes} volumes
            {uniqueCtcs < ctcs && (
              <span className="block text-xs text-muted-foreground">
                {uniqueCtcs} CTCs únicos · totais acima incluem cada tentativa de rota
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button type="button" disabled={!canSave} onClick={save}>
              <Check size={16} /> Cadastrar {chosen.length || ""} manifestos
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
