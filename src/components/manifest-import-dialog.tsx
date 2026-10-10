import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Images, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ManifestDocumentsEditor } from './manifest-documents-editor';
import type { Manifest } from '@/lib/conference';
import type { ImportDraft, ImportOutcome } from '@/lib/manifest-import';

type Draft = ImportDraft & { key: string; filename: string; file?: File; url?: string; text?: string; status: 'manual' | 'waiting' | 'reading' | 'read' | 'error'; kind?: 'pre' | 'dacte' | 'unknown'; message?: string; seconds?: number };
const blank = (): Draft => ({ key: crypto.randomUUID(), filename: 'Cadastro manual', status: 'manual', id: '', plate: '', driver: '', rows: [{ ctc: '', nf: '', volumes: '1' }] });

export function ManifestImportDialog({ open, onOpenChange, manifests, onCreate, initialId }: {
  initialId?: string; open: boolean; onOpenChange: (open: boolean) => void; manifests: Manifest[]; onCreate: (drafts: ImportDraft[]) => ImportOutcome;
}) {
  const [items, setItems] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => { if (open && !items.length) setItems([blank()]); }, [open, items.length]);
  useEffect(() => { if (open && initialId) { setItems(list => [...list.filter(item => item.status !== 'manual' || item.id), { ...blank(), id: initialId }]); setActive(items.length && items[0]?.id ? items.length : 0); setSelectedRow(0); } }, [open, initialId]);
  useEffect(() => () => { controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const draft = items[active];
  const update = (change: Partial<Draft>) => setItems(list => list.map((item, i) => i === active ? { ...item, ...change } : item));
  async function readFiles(input: FileList | File[] | null, detailed = false, replaceKey?: string) {
    const files = Array.from(input ?? []).filter(file => file.type.startsWith('image/'));
    if (!files.length || busy) return;
    setError(''); setBusy(true); setSelectedRow(0);
    const additions: Draft[] = files.map(file => {
      const url = URL.createObjectURL(file); urls.current.push(url);
      return { ...(items.find(item => item.key === replaceKey) ?? blank()), key: crypto.randomUUID(), file, filename: file.name, url, status: 'waiting', rows: [{ ctc: '', nf: '', volumes: '' }] };
    });
    const keep = items.filter(item => item.key !== replaceKey && (item.status !== 'manual' || item.id || item.driver || item.rows.some(row => row.ctc)));
    setItems([...keep, ...additions]); setActive(keep.length);
    const abort = new AbortController(); controller.current = abort;
    try {
      const { readPrePhotos } = await import('@/lib/photo-ocr');
      await readPrePhotos(files, (index, result) => {
        const key = additions[index]!.key;
        setItems(list => list.map(item => item.key !== key ? item : 'error' in result ? { ...item, status: 'error', message: result.error } : {
          ...item, id: result.pre.id || item.id, plate: result.pre.plate || item.plate, driver: result.pre.driver || item.driver, kind: result.pre.kind, status: 'read', text: result.text,
          rows: result.pre.documents.length ? result.pre.documents : result.pre.ctcs.length ? result.pre.ctcs.map(ctc => ({ ctc, nf: '', volumes: '' })) : [{ ctc: '', nf: '', volumes: '' }],
          seconds: result.milliseconds / 1000,
          message: result.pre.documents.length ? `${result.pre.documents.length} CTC(s) lidos. Revise os campos sinalizados.` : 'Não identifiquei CTCs. Confira a foto e complete os campos.',
        }));
      }, (index, message) => {
        setProgress(`Foto ${index + 1} de ${files.length} · ${message}`);
        setItems(list => list.map(item => item.key === additions[index]!.key ? { ...item, status: 'reading' } : item));
      }, abort.signal, detailed);
    } catch { setError('Falha ao iniciar o leitor. Suas fotos continuam na lista para tentar novamente.'); }
    finally { setBusy(false); controller.current = null; setProgress(''); setItems(list => list.map(item => item.status === 'waiting' || item.status === 'reading' ? { ...item, status: 'error', message: 'Leitura interrompida. Envie esta foto novamente.' } : item)); }
  }
  function save(all: boolean) {
    const chosen = all ? items : draft ? [draft] : [];
    const result = onCreate(chosen);
    if (!result.ok) { setError(result.error); setActive(all ? result.index : active); setSelectedRow(result.row ?? 0); return; }
    const keys = new Set(chosen.map(item => item.key));
    chosen.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); });
    const remaining = items.filter(item => !keys.has(item.key));
    setItems(remaining); setActive(0); setSelectedRow(0); setError('');
    if (!remaining.length) onOpenChange(false);
  }
  const waiting = draft?.status === 'waiting' || draft?.status === 'reading';
  const targets = [...manifests.map(item => ({ id: item.id, driver: item.driver })), ...items.filter(item => item.kind === 'pre' && item.id && !manifests.some(m => m.id === item.id)).map(item => ({ id: item.id, driver: item.driver }))];
  return <Dialog open={open} onOpenChange={value => { if (!value) controller.current?.abort(); onOpenChange(value); }}><DialogContent className="max-h-[92dvh] overflow-y-auto"><DialogHeader>
    <DialogTitle>Importar pré-manifestos</DialogTitle><DialogDescription>Selecione as fotos dos seus prés de uma vez. A leitura rápida preenche os dados; revise os campos sinalizados.</DialogDescription>
  </DialogHeader>
    <div className="grid grid-cols-2 gap-2">
      <label className="photo-pick"><input type="file" accept="image/*" multiple className="sr-only" disabled={busy} aria-label="Enviar várias fotos" onChange={event => { void readFiles(event.target.files); event.target.value = ''; }} /><Images size={20} /><span>Enviar fotos<small>Selecione todos os prés</small></span></label>
      <label className="photo-pick"><input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} aria-label="Tirar foto" onChange={event => { void readFiles(event.target.files); event.target.value = ''; }} /><Camera size={20} /><span>Tirar foto<small>Adicionar à lista</small></span></label>
    </div>
    {busy && <div role="status" className="rounded-md bg-primary/5 p-3 text-xs flex items-center gap-2"><Loader2 className="animate-spin shrink-0" size={16} />{progress}<Button type="button" variant="ghost" size="sm" onClick={() => controller.current?.abort()}>Parar</Button></div>}
    {items.length > 1 && <label className="form-field">Fotos na lista ({items.length})<select aria-label="Selecionar foto do lote" className="border border-border bg-background rounded-md p-2" value={active} onChange={event => { setActive(Number(event.target.value)); setSelectedRow(0); setError(''); }}>{items.map((item, i) => <option key={item.key} value={i}>{i + 1}. {item.id || item.filename} · {item.status === 'read' ? item.rows.some(row => row.ctc) ? `${item.rows.filter(row => row.ctc).length} CTCs` : 'Revisar' : item.status === 'error' ? 'Revisar' : item.status === 'reading' ? 'Lendo…' : item.status === 'waiting' ? 'Na fila' : 'Manual'}</option>)}</select></label>}
    {draft && <form className="grid gap-4" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save(false); }}>
      {draft.url && <details className="text-xs"><summary className="cursor-pointer text-primary">Ver foto · {draft.filename}</summary><img className="mt-2 max-h-80 w-full object-contain rounded-md" src={draft.url} alt="Documento enviado para conferência" /></details>}
      {draft.kind === 'dacte' && <label className="form-field">DACTE avulso — vincular ao pré<select aria-label="Vincular DACTE ao pré" className="border border-border bg-background rounded-md p-2" value={draft.targetId || ''} onChange={event => update({ targetId: event.target.value })}><option value="">Selecione um pré cadastrado ou preencha abaixo</option>{targets.map(item => <option key={item.id} value={item.id}>{item.id} · {item.driver}</option>)}</select></label>}
      {!draft.targetId && <div className="form-grid">
        <label className="form-field">Número do pré<input aria-label="Número do pré" disabled={waiting} value={draft.id} placeholder="DI00000000000" onChange={event => update({ id: event.target.value })} /></label>
        <label className="form-field">Placa<input aria-label="Placa" disabled={waiting} value={draft.plate} maxLength={8} placeholder="ABC1D23" onChange={event => update({ plate: event.target.value })} /></label>
        <label className="form-field col-span-2">Motorista<input aria-label="Motorista" disabled={waiting} value={draft.driver} onChange={event => update({ driver: event.target.value })} /></label>
      </div>}
      <ManifestDocumentsEditor rows={draft.rows} onChange={rows => update({ rows })} selectedIndex={selectedRow} onSelect={setSelectedRow} disabled={waiting} />
      {draft.message && <p className="text-xs text-muted-foreground" role="status">{draft.message}{draft.seconds !== undefined && ` (${draft.seconds.toFixed(1)} s)`}</p>}
      {draft.file && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void readFiles([draft.file!], true, draft.key); }}>Reler detalhes desta foto</Button>}
      {draft.text && <details className="text-xs text-muted-foreground"><summary>Texto lido da foto</summary><textarea readOnly className="w-full h-28 border rounded-md p-2 mt-2" value={draft.text} /></details>}
      {error && <p className="text-destructive text-xs" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2 justify-between border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { if (draft.url) URL.revokeObjectURL(draft.url); setItems(list => list.filter(item => item.key !== draft.key)); setActive(Math.max(0, active - 1)); setSelectedRow(0); }}><Trash2 size={14} />Remover foto</Button>
        <Button type="submit" disabled={busy || waiting}>{draft.targetId ? 'Adicionar ao pré' : 'Cadastrar pré'}</Button>
        {items.length > 1 && <Button type="button" disabled={busy} onClick={() => save(true)}>Cadastrar lote ({items.length})</Button>}
      </div>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setItems(list => [...list, blank()]); setActive(items.length); setSelectedRow(0); }}><Plus size={14} />Adicionar pré manualmente</Button>
    </form>}
  </DialogContent></Dialog>;
}
