import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Search, UploadCloud } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import type { Manifest } from '@/lib/conference';
import { findImportConflicts, type ImportDraft, type ImportOutcome } from '@/lib/manifest-import';
import type { LuftExport } from '@/lib/luft-spreadsheet';
import { formatManifestDate } from '@/lib/manifest-date';

export function SpreadsheetImportDialog({ manifests, onClose, onCreate }: { manifests: Manifest[]; onClose: () => void; onCreate: (drafts: ImportDraft[]) => ImportOutcome }) {
  const [result, setResult] = useState<LuftExport | null>(null);
  const [filename, setFilename] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  function stop() { controller.current?.abort(); controller.current = null; setBusy(false); }
  function close() { stop(); onClose(); }
  async function load(file?: File) {
    if (!file) return;
    stop();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setResult(null); setSelected(new Set()); setQuery(''); setActive(''); setFilename(file.name);
    const start = performance.now();
    try {
      const { readLuftSpreadsheet } = await import('@/lib/read-luft-spreadsheet');
      if (abort.signal.aborted) return;
      const parsed = await readLuftSpreadsheet(file, abort.signal);
      if (abort.signal.aborted || controller.current !== abort) return;
      setResult(parsed); setSeconds((performance.now() - start) / 1000);
      const conflicts = new Set(findImportConflicts(manifests, parsed.drafts).map(conflict => conflict.index));
      setSelected(new Set(parsed.drafts.filter((_, index) => !conflicts.has(index)).map(draft => draft.id)));
      setActive(parsed.drafts[0]?.id ?? '');
    } catch (cause) { if (!abort.signal.aborted && controller.current === abort) setError(cause instanceof Error ? cause.message : 'Não foi possível ler a planilha.'); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  const drafts = result?.drafts ?? [];
  const conflicts = findImportConflicts(manifests, drafts);
  const blocked = new Set(conflicts.map(conflict => drafts[conflict.index]?.id));
  const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const visible = drafts.filter(draft => normalized(`${draft.driver} ${draft.plate} ${draft.id}`).includes(normalized(query.trim())));
  const chosen = drafts.filter(draft => selected.has(draft.id));
  const current = drafts.find(draft => draft.id === active);
  const ctcs = chosen.reduce((sum, draft) => sum + (draft.expectedRows ?? 0), 0);
  const nfs = chosen.reduce((sum, draft) => sum + draft.rows.length, 0);
  const volumes = chosen.reduce((sum, draft) => sum + (draft.totalVolumes ?? 0), 0);
  const canSave = !busy && chosen.length > 0 && !result?.errors.length && chosen.every(draft => !blocked.has(draft.id));
  function save() {
    if (!canSave) return;
    const outcome = onCreate(chosen);
    if (outcome.ok) close();
    else { setError(outcome.error); setActive(chosen[outcome.index]?.id ?? ''); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="sheet-import-dialog w-[calc(100vw-1rem)] max-w-5xl max-h-[94dvh] flex flex-col overflow-hidden p-0">
    <DialogHeader className="shrink-0 border-b px-5 py-5 sm:px-7">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><FileSpreadsheet size={25} /></span><div><DialogTitle>Importar planilha da Luft</DialogTitle><DialogDescription className="mt-1">Relatório 108 · Filial 06 · DIS (Distribuição). Sem fotos e sem IA.</DialogDescription></div></div>
    </DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7 space-y-4">
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 hover:bg-primary/10">
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Enviar planilha 108" disabled={busy} onChange={event => { void load(event.target.files?.[0]); event.target.value = ''; }} />
        <UploadCloud size={24} className="shrink-0 text-primary" /><span className="min-w-0"><strong className="block text-sm">{filename || 'Selecionar planilha 108'}</strong><span className="text-xs text-muted-foreground">Um arquivo XLSX, até 8 MB. TRA e outras filiais ficam de fora.</span></span>
      </label>
      {busy && <div className="flex items-center justify-between gap-3 rounded-lg border p-3" role="status"><span className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={17} />Lendo a planilha no navegador…</span><Button type="button" size="sm" variant="outline" onClick={stop}>Parar</Button></div>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {!!result?.errors.length && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><strong className="flex gap-2 items-center"><AlertCircle size={16} />Corrija o relatório antes de cadastrar</strong><p className="mt-1">Há linhas inválidas ou conflitantes na filial 06 / DIS. O lote não será salvo parcialmente.</p><ul className="mt-2 max-h-32 overflow-auto list-disc pl-5">{result.errors.map((message, i) => <li key={i}>{message}</li>)}</ul></div>}
      {result && <>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900" role="status"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} />{drafts.length} manifestos encontrados · {seconds.toFixed(1).replace('.', ',')} s</p><p className="mt-1 text-xs">{result.ignored} linhas de outras filiais ou motivos ignoradas. {result.repeated} repetições idênticas removidas. Nada foi cadastrado ainda.</p></div>
        <div className="flex flex-wrap items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2"><Search size={15} className="text-muted-foreground" /><input className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Buscar motorista, placa ou manifesto na planilha" placeholder="Motorista, placa ou manifesto" value={query} onChange={event => setQuery(event.target.value)} /></label><Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set(visible.filter(draft => !blocked.has(draft.id)).map(draft => draft.id)))}>Selecionar resultados</Button><Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Limpar seleção</Button></div>
        <p className="text-xs text-muted-foreground">A busca filtra a lista; não altera a seleção. “Selecionar resultados” substitui a seleção pelos resultados visíveis. Cadastros repetidos ficam bloqueados.</p>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-xs"><thead className="bg-muted/50"><tr>{['Selecionar', 'Manifesto / motorista', 'Placa', 'Emissão', 'CTCs', 'NFs', 'Volumes', 'Situação'].map(label => <th className="p-3 font-medium whitespace-nowrap" key={label}>{label}</th>)}</tr></thead><tbody>{visible.map(draft => <tr className={draft.id === active ? 'bg-primary/5' : ''} key={draft.id}>
          <td className="border-t p-3"><input type="checkbox" aria-label={`Selecionar manifesto ${draft.id}`} disabled={blocked.has(draft.id)} checked={selected.has(draft.id)} onChange={event => setSelected(old => { const next = new Set(old); if (event.target.checked) next.add(draft.id); else next.delete(draft.id); return next; })} /></td>
          <td className="border-t p-3"><button type="button" className="text-left hover:underline" aria-label={`Ver NFs do manifesto ${draft.id}`} onClick={() => setActive(draft.id)}><strong className="block font-mono text-primary">{draft.id}</strong><span className="block mt-1 min-w-40">{draft.driver}</span></button></td>
          <td className="border-t p-3 font-mono">{draft.plate}</td><td className="border-t p-3 whitespace-nowrap">{formatManifestDate(draft.issueDate)}</td><td className="border-t p-3">{draft.expectedRows}</td><td className="border-t p-3">{draft.rows.length}</td><td className="border-t p-3">{draft.totalVolumes}</td>
          <td className="border-t p-3 min-w-40">{blocked.has(draft.id) ? <span className="text-amber-800">{conflicts.filter(conflict => drafts[conflict.index]?.id === draft.id).slice(0, 1).map(conflict => conflict.message)}</span> : <span className="text-emerald-700">Pronto para cadastrar</span>}</td>
        </tr>)}</tbody></table>{!visible.length && <p className="p-5 text-center text-sm text-muted-foreground">Nenhum manifesto nesta busca.</p>}</div>
        {current && <details key={current.id} open className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">NFs do manifesto {current.id} · {current.driver}</summary><div className="mt-3 max-h-56 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{['CTC', 'NF-série', 'Volumes', 'Remetente', 'Destinatário'].map(label => <th key={label} className="pb-2 pr-4">{label}</th>)}</tr></thead><tbody>{current.rows.map((row, i) => <tr key={i}><td className="py-2 pr-4 font-mono">{row.ctc}</td><td className="py-2 pr-4 whitespace-nowrap">{row.nf}</td><td className="py-2 pr-4">{row.volumes}</td><td className="py-2 pr-4">{row.client}</td><td className="py-2">{row.recipient}</td></tr>)}</tbody></table></div></details>}
        <p className="text-xs text-muted-foreground">O número e a emissão são do manifesto exportado. O DI do pré não é necessário. NFs do mesmo CTC ficam juntas para uma única conferência.</p>
      </>}
    </div>
    <div className="shrink-0 border-t px-5 py-4 sm:px-7 flex flex-wrap items-center justify-between gap-3"><p className="text-sm" role="status">{chosen.length} manifestos · {ctcs} CTCs · {nfs} NFs · {volumes} volumes</p><div className="flex gap-2"><Button type="button" variant="outline" onClick={close}>Cancelar</Button><Button type="button" disabled={!canSave} onClick={save}>Cadastrar {chosen.length || ''} manifestos</Button></div></div>
  </DialogContent></Dialog>;
}
