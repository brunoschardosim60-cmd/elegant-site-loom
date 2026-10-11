import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Camera, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, FileImage, Images, Loader2, Plus, RotateCw, ScanLine, Trash2, UploadCloud } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ManifestDocumentsEditor } from './manifest-documents-editor';
import type { Manifest } from '@/lib/conference';
import type { ImportDraft, ImportOutcome } from '@/lib/manifest-import';
import { photoReaderStatus } from '@/lib/photo-reader.functions';

type Verification = { status: 'matched' | 'review' | 'unavailable'; checkedFields: number; conflicts: number };
type Draft = ImportDraft & {
  key: string; filename: string; file?: File; url?: string; text?: string;
  status: 'manual' | 'waiting' | 'reading' | 'read' | 'error';
  kind?: 'pre' | 'dacte' | 'unknown'; message?: string; seconds?: number;
  verification?: Verification | undefined; headerReview?: string[] | undefined; expectedRows?: number | undefined; totalVolumes?: number | undefined; edited?: boolean; progress?: string;
};
const blank = (): Draft => ({ key: crypto.randomUUID(), filename: 'Cadastro manual', status: 'manual', id: '', plate: '', driver: '', rows: [{ ctc: '', nf: '', volumes: '1' }] });
const documentCount = (item: Draft) => item.rows.filter(row => row.ctc).length;
const volumeCount = (item: Draft) => item.rows.reduce((sum, row) => sum + (Number.isInteger(Number(row.volumes)) && Number(row.volumes) > 0 ? Number(row.volumes) : 0), 0);
const reviewCount = (item: Draft) => item.rows.filter(row => row.review?.length).length;
const statusText = (item: Draft) => item.status === 'read' ? item.edited ? 'Ajustado manualmente' : reviewCount(item) || item.headerReview?.length || item.verification?.status === 'review' ? 'Conferir campos' : 'Leitura concluída' : item.status === 'error' ? 'Leitura interrompida' : item.status === 'reading' ? 'Lendo documento' : item.status === 'waiting' ? 'Aguardando leitura' : 'Cadastro manual';
const hasManualContent = (item: Draft) => item.id || item.plate || item.driver || item.rows.some(row => row.ctc || row.nf || row.client || row.recipient || (row.volumes && row.volumes !== '1'));

export function ManifestImportDialog({ open, onOpenChange, manifests, onCreate, initialId }: {
  initialId?: string; open: boolean; onOpenChange: (open: boolean) => void; manifests: Manifest[]; onCreate: (drafts: ImportDraft[]) => ImportOutcome;
}) {
  const [items, setItems] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [reader, setReader] = useState<'checking' | 'ai' | 'local'>('checking');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewRotation, setPreviewRotation] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => { let mounted = true; void photoReaderStatus().then(status => { if (mounted) { setAiAvailable(status.configured); setReader(status.configured ? 'ai' : 'local'); } }).catch(() => { if (mounted) setReader('local'); }); return () => { mounted = false; }; }, []);
  useEffect(() => { if (open && !items.length) setItems([blank()]); }, [open, items.length]);
  useEffect(() => { if (open && initialId) { setItems(list => [...list.filter(item => item.status !== 'manual' || hasManualContent(item)), { ...blank(), id: initialId }]); setActive(items.length && items[0]?.id ? items.length : 0); setSelectedRow(0); } }, [open, initialId]);
  useEffect(() => () => { controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const draft = items[active];
  const update = (change: Partial<Draft>) => { setError(''); setItems(list => list.map((item, i) => i === active ? { ...item, ...change, ...(item.status === 'read' ? { edited: true } : {}) } : item)); };
  const selectItem = (index: number) => { setActive(index); setSelectedRow(0); setPreviewRotation(0); setError(''); };
  const releaseUrl = (url?: string) => { if (url) { URL.revokeObjectURL(url); urls.current = urls.current.filter(item => item !== url); } };
  function closeDialog(value: boolean) {
    if (!value) {
      controller.current?.abort(); controller.current = null;
      urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = [];
      setItems([]); setActive(0); setSelectedRow(0); setError(''); setProgress(''); setBusy(false); setDragging(false); setPreviewRotation(0);
    }
    onOpenChange(value);
  }
  async function readFiles(input: FileList | File[] | null, detailed = false, replaceKey?: string) {
    if (busy || reader === 'checking') return;
    const selected = Array.from(input ?? []);
    const files = selected.filter(file => file.type.startsWith('image/'));
    if (!files.length) { if (selected.length) setError('Envie uma foto em JPG, PNG ou WebP. Arquivos PDF ainda não são aceitos.'); return; }
    setError(selected.length !== files.length ? 'Alguns arquivos foram ignorados. Envie fotos em JPG, PNG ou WebP.' : '');
    setBusy(true); setSelectedRow(0); setPreviewRotation(0);
    const additions: Draft[] = files.map(file => {
      const url = URL.createObjectURL(file); urls.current.push(url);
      return { ...(items.find(item => item.key === replaceKey) ?? blank()), key: crypto.randomUUID(), file, filename: file.name, url, status: 'waiting', rows: [{ ctc: '', nf: '', volumes: '' }], verification: undefined, headerReview: undefined, edited: false };
    });
    const replaced = items.find(item => item.key === replaceKey);
    if (replaced) releaseUrl(replaced.url);
    const keep = items.filter(item => item.key !== replaceKey && (item.status !== 'manual' || hasManualContent(item)));
    setItems([...keep, ...additions]); setActive(keep.length);
    const abort = new AbortController(); controller.current = abort;
    try {
      const readPrePhotos = reader === 'ai' ? (await import('@/lib/photo-ai')).readAiPhotos : (await import('@/lib/photo-ocr')).readPrePhotos;
      await readPrePhotos(files, (index, result) => {
        if (abort.signal.aborted) return;
        const key = additions[index]!.key;
        setItems(list => list.map(item => item.key !== key ? item : 'error' in result ? { ...item, status: 'error', message: result.error } : {
          ...item, id: result.pre.id || item.id, plate: result.pre.plate || item.plate, driver: result.pre.driver || item.driver, kind: result.pre.kind, status: 'read', text: result.text,
          rows: result.pre.documents.length ? result.pre.documents : result.pre.ctcs.length ? result.pre.ctcs.map(ctc => ({ ctc, nf: '', volumes: '' })) : [{ ctc: '', nf: '', volumes: '' }],
          verification: result.pre.verification, headerReview: result.pre.headerReview,
          expectedRows: result.pre.expectedRows, totalVolumes: result.pre.totalVolumes,
          seconds: result.milliseconds / 1000,
          message: result.pre.documents.length ? `${result.pre.documents.length} CTC(s) identificados.` : 'Não identifiquei CTCs. Confira a foto e complete os campos.',
        }));
      }, (index, message) => {
        if (abort.signal.aborted) return;
        setProgress(`Foto ${index + 1} de ${files.length} · ${message}`);
        setItems(list => list.map(item => item.key === additions[index]!.key ? { ...item, status: 'reading', progress: message } : item));
      }, abort.signal, detailed);
    } catch { if (!abort.signal.aborted) setError('Falha ao iniciar o leitor. Suas fotos continuam na lista para tentar novamente.'); }
    finally {
      if (controller.current === abort) {
        setBusy(false); controller.current = null; setProgress('');
        setItems(list => list.map(item => item.status === 'waiting' || item.status === 'reading' ? { ...item, status: 'error', message: 'Leitura interrompida. Tente ler esta foto novamente.' } : item));
      }
    }
  }
  function save(all: boolean) {
    const chosen = all ? items : draft ? [draft] : [];
    const result = onCreate(chosen);
    if (!result.ok) { setError(result.error); setActive(all ? result.index : active); setSelectedRow(result.row ?? 0); return; }
    const keys = new Set(chosen.map(item => item.key));
    chosen.forEach(item => releaseUrl(item.url));
    const remaining = items.filter(item => !keys.has(item.key));
    setItems(remaining); setActive(0); setSelectedRow(0); setPreviewRotation(0); setError('');
    if (!remaining.length) closeDialog(false);
  }
  const waiting = draft?.status === 'waiting' || draft?.status === 'reading';
  const filled = draft?.rows.filter(row => row.ctc && row.nf && Number(row.volumes) > 0 && row.client && row.recipient).length ?? 0;
  const photoCount = items.filter(item => item.file).length;
  const completed = items.filter(item => item.status === 'read' || item.status === 'error').length;
  const detected = items.reduce((sum, item) => sum + documentCount(item), 0);
  const volumes = items.reduce((sum, item) => sum + volumeCount(item), 0);
  const locked = busy || reader === 'checking';
  const verifiedTitle = draft?.kind === 'dacte' ? 'Números conferidos' : 'Cabeçalho e números conferidos';
  const verifiedDescription = `Duas leituras concordam em ${draft?.verification?.checkedFields ?? 0} campos: ${draft?.kind === 'dacte' ? 'CTC, NF e volumes' : 'pré, placa, motorista, CTC, NF e volumes'}. Confira os nomes dos clientes e destinatários.`;
  const targets = [...manifests.map(item => ({ id: item.id, driver: item.driver })), ...items.filter(item => item.kind === 'pre' && item.id && !manifests.some(m => m.id === item.id)).map(item => ({ id: item.id, driver: item.driver }))];
  return <Dialog open={open} onOpenChange={closeDialog}><DialogContent className="import-dialog">
    <DialogHeader className="import-header">
      <div className="import-heading-icon"><ScanLine size={23} /></div>
      <div><span className="import-eyebrow">Entrada de documentos</span><DialogTitle>Importar pré-manifestos</DialogTitle><DialogDescription>Uma foto ou um lote inteiro. Acompanhe a leitura e confira os dados antes de cadastrar.</DialogDescription></div>
    </DialogHeader>
    <div className="import-toolbar" onDragEnter={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); void readFiles(event.dataTransfer.files); }} data-dragging={dragging}>
      <div className="import-upload-actions">
        <label className="import-upload-card" data-disabled={locked}><input type="file" accept="image/*" multiple className="sr-only" disabled={locked} aria-label="Enviar várias fotos" onChange={event => { void readFiles(event.target.files); event.target.value = ''; }} /><UploadCloud size={24} /><span><strong>Selecionar fotos</strong><small>Uma ou várias · JPG, PNG, WebP</small></span><Plus size={18} className="import-upload-plus" /></label>
        <label className="import-camera-card" data-disabled={locked}><input type="file" accept="image/*" capture="environment" className="sr-only" disabled={locked} aria-label="Tirar foto" onChange={event => { void readFiles(event.target.files); event.target.value = ''; }} /><Camera size={21} /><span>Tirar foto</span></label>
      </div>
      <div className="import-reader-settings">
        <span className="import-reader-badge"><span className={reader === 'checking' ? 'import-dot checking' : 'import-dot'} />{reader === 'ai' ? 'Leitura por IA' : reader === 'checking' ? 'Preparando leitor…' : 'Leitura local'}</span>
        <details><summary>Opções de leitura</summary><div className="import-reader-options"><label className="form-field">Leitor<select aria-label="Leitor de fotos" disabled={locked} value={reader} onChange={e => setReader(e.target.value as 'ai' | 'local')}><option value="checking" disabled>Verificando leitor…</option><option value="ai" disabled={!aiAvailable}>Gemini · leitura por IA{!aiAvailable && ' (indisponível)'}</option><option value="local">Leitura no navegador</option></select></label><p>{reader === 'ai' ? 'As fotos são enviadas ao Google Gemini para ler os documentos.' : reader === 'checking' ? 'Verificando disponibilidade da IA…' : 'Números pequenos podem ficar incompletos na leitura local.'}</p></div></details>
      </div>
      {dragging && <div className="import-drop-overlay"><Images size={30} /><strong>Solte as fotos para ler</strong></div>}
    </div>
    {busy && <div role="status" className="import-progress"><Loader2 className="animate-spin" size={18} /><div><strong>{progress || 'Preparando suas fotos…'}</strong><span>{completed} de {photoCount} fotos processadas. Você pode conferir as que já terminaram.</span><div className="import-progress-track" role="progressbar" aria-label="Fotos processadas" aria-valuemin={0} aria-valuemax={photoCount} aria-valuenow={completed}><i style={{ width: `${photoCount ? completed / photoCount * 100 : 0}%` }} /></div></div><Button type="button" variant="ghost" size="sm" onClick={() => controller.current?.abort()}>Parar</Button></div>}
    <div className="import-body">
      <aside className="import-queue" aria-label="Arquivos para importar">
        <div className="import-queue-heading"><div><span className="import-eyebrow">Sua lista</span><h3>{photoCount ? `${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'}` : 'Novo pré'}</h3></div><span className="import-queue-count">{items.length}</span></div>
        <div className="import-batch-totals"><span><strong>{detected}</strong> CTCs</span><span><strong>{volumes}</strong> volumes</span></div>
        {items.length > 1 && <label className="form-field import-mobile-select">Documento selecionado<select aria-label="Selecionar foto do lote" value={active} onChange={event => selectItem(Number(event.target.value))}>{items.map((item, i) => <option key={item.key} value={i}>{i + 1}. {item.id || item.filename} · {statusText(item)}</option>)}</select></label>}
        <div className="import-queue-list">{items.map((item, index) => <button type="button" className="import-queue-item" key={item.key} aria-label={`Revisar arquivo ${index + 1}: ${item.id || item.filename}`} aria-pressed={index === active} onClick={() => selectItem(index)}>
          <div className="import-queue-thumb">{item.url ? <img src={item.url} alt="" /> : <FileImage size={22} />}<span>{index + 1}</span></div>
          <div className="import-queue-copy"><strong>{item.id || (item.file ? 'Identificando pré…' : 'Cadastro manual')}</strong><small>{item.driver || item.filename}</small><span className={`import-file-status ${item.status === 'error' || item.headerReview?.length || reviewCount(item) ? 'warning' : item.status === 'read' ? 'success' : ''}`}>{item.status === 'reading' ? <Loader2 className="animate-spin" /> : item.status === 'error' ? <AlertCircle /> : item.status === 'read' ? <CheckCircle2 /> : null}{statusText(item)}</span>{item.status === 'reading' && item.progress && <span className="import-queue-progress">{item.progress}</span>}{item.status === 'read' && <span className="import-queue-numbers">{documentCount(item)} CTCs · {volumeCount(item)} volumes</span>}</div>
        </button>)}</div>
        <Button type="button" variant="outline" size="sm" className="import-manual-button" disabled={busy} onClick={() => { setItems(list => [...list, blank()]); selectItem(items.length); }}><Plus size={15} />Adicionar pré manualmente</Button>
        <p className="import-draft-note">Os documentos só serão salvos ao cadastrar. Fechar descarta este rascunho.</p>
      </aside>
      {draft && <form className="import-review" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save(false); }}>
        <div className="import-review-heading"><div><span className="import-eyebrow">Documento {active + 1} de {items.length}</span><h3>{draft.id || (draft.file ? 'Lendo seu documento' : 'Preencha os dados do pré')}</h3><p>{draft.file ? draft.filename : 'Cadastre os documentos sem enviar uma foto.'}</p></div><span className={`import-file-status ${draft.status === 'error' || draft.headerReview?.length || reviewCount(draft) ? 'warning' : draft.status === 'read' ? 'success' : ''}`}>{waiting ? <Loader2 className="animate-spin" /> : draft.status === 'read' ? <CheckCircle2 /> : null}{statusText(draft)}</span></div>
        {error && <div className="import-alert error" role="alert"><AlertCircle size={18} /><div><strong>Confira antes de cadastrar</strong><p>{error}</p></div></div>}
        {draft.status === 'error' && <div className="import-alert error" role="alert"><AlertCircle size={18} /><div><strong>Não foi possível concluir esta foto</strong><p>{draft.message}</p></div></div>}
        {draft.verification && <div className={`import-alert ${draft.verification.status === 'matched' && !draft.edited ? 'verified' : 'warning'}`} role="status">{draft.verification.status === 'matched' && !draft.edited ? <CheckCheck size={19} /> : <AlertCircle size={19} />}<div><strong>{draft.edited ? 'Dados ajustados manualmente' : draft.verification.status === 'matched' ? verifiedTitle : draft.verification.status === 'review' ? draft.verification.conflicts > 0 ? 'As leituras encontraram diferenças' : 'Há campos para conferir' : 'A segunda leitura não foi concluída'}</strong><p>{draft.edited ? 'A conferência automática corresponde à leitura original. Confira também os campos que você alterou.' : draft.verification.status === 'matched' ? verifiedDescription : draft.verification.status === 'review' ? draft.verification.conflicts > 0 ? `${draft.verification.conflicts} divergência(s). Confira os campos sinalizados na foto.` : 'Confira os avisos e os campos sinalizados na foto.' : 'Confira os campos extraídos antes de cadastrar.'}</p></div></div>}
        {!!draft.headerReview?.length && <div className="import-alert warning" role="status"><AlertCircle size={18} /><div><strong>Conferir os dados do pré</strong>{draft.headerReview.map(message => <p key={message}>{message}</p>)}</div></div>}
        <div className={`import-review-columns ${draft.url ? 'with-photo' : ''}`}>
          <section className="import-details-panel"><div className="import-section-title"><span>1</span><h4>Dados do pré</h4></div>
            {draft.kind === 'dacte' && <label className="form-field import-target">DACTE avulso — vincular ao pré<select aria-label="Vincular DACTE ao pré" disabled={waiting} value={draft.targetId || ''} onChange={event => update({ targetId: event.target.value })}><option value="">Selecione um pré ou preencha abaixo</option>{targets.map(item => <option key={item.id} value={item.id}>{item.id} · {item.driver}</option>)}</select></label>}
            {!draft.targetId && <div className="import-manifest-fields"><label className="form-field">Número do pré<input aria-label="Número do pré" disabled={waiting} value={draft.id} placeholder="DI00000000000" onChange={event => update({ id: event.target.value })} /></label><label className="form-field">Placa<input aria-label="Placa" disabled={waiting} value={draft.plate} maxLength={8} placeholder="ABC1D23" onChange={event => update({ plate: event.target.value })} /></label><label className="form-field import-driver-field">Motorista<input aria-label="Motorista" disabled={waiting} value={draft.driver} placeholder="Nome do motorista" onChange={event => update({ driver: event.target.value })} /></label></div>}
            {draft.status === 'read' && <div className="import-document-totals"><span><strong>{documentCount(draft)}{draft.expectedRows != null && draft.expectedRows > 0 && draft.expectedRows !== documentCount(draft) ? ` / ${draft.expectedRows}` : ''}</strong> CTCs lidos</span><span><strong>{volumeCount(draft)}{draft.totalVolumes != null && draft.totalVolumes > 0 && draft.totalVolumes !== volumeCount(draft) ? ` / ${draft.totalVolumes}` : ''}</strong> volumes</span>{draft.seconds !== undefined && <span><strong>{draft.seconds.toFixed(1)} s</strong> de leitura</span>}</div>}
          </section>
          {draft.url && <section className="import-photo-panel"><div className="import-photo-heading"><span>Foto original</span><Button type="button" variant="ghost" size="icon" aria-label="Girar visualização da foto" title="Girar visualização da foto" onClick={() => setPreviewRotation(value => (value + 90) % 360)}><RotateCw size={15} /></Button></div><a href={draft.url} target="_blank" rel="noreferrer" className="import-photo-frame" aria-label="Ampliar foto original"><img src={draft.url} style={{ transform: `rotate(${previewRotation}deg)` }} alt="Documento enviado para conferência" /></a><span className="import-photo-caption">Toque na foto para ampliar</span></section>}
        </div>
        {waiting ? <div className="import-reading-placeholder" role="status"><ScanLine size={30} className={draft.status === 'reading' ? 'animate-pulse' : ''} /><strong>{draft.status === 'waiting' ? 'Esta foto está na fila' : 'Lendo todas as linhas do documento'}</strong><p>{draft.status === 'waiting' ? 'As fotos prontas já podem ser conferidas na lista.' : 'CTCs, notas fiscais, volumes e clientes aparecerão aqui.'}</p></div> : <>
          <ManifestDocumentsEditor rows={draft.rows} onChange={rows => update({ rows })} selectedIndex={selectedRow} onSelect={setSelectedRow} disabled={waiting} />
          {draft.status === 'read' && <p className="import-completeness" role="status">{filled} de {draft.rows.length} CTC(s) com NF, volumes, cliente e destinatário preenchidos.{reviewCount(draft) > 0 && ` ${reviewCount(draft)} CTC(s) com campos para conferir.`}</p>}
        </>}
        {draft.file && !waiting && <div className="import-read-tools"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void readFiles([draft.file!], true, draft.key); }}><ScanLine size={15} />{draft.status === 'error' ? 'Tentar ler novamente' : 'Reler detalhes desta foto'}</Button>{draft.text && <details className="import-raw-text"><summary>Texto identificado</summary><textarea readOnly aria-label="Texto lido da foto" value={draft.text} /></details>}</div>}
        <div className="import-form-footer"><div className="import-footer-info"><span>{documentCount(draft)} CTCs · {volumeCount(draft)} volumes</span><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { releaseUrl(draft.url); setItems(list => list.filter(item => item.key !== draft.key)); selectItem(Math.max(0, active - 1)); }}><Trash2 size={14} />{draft.file ? 'Remover foto' : 'Remover pré'}</Button></div><div className="import-save-actions"><Button type="submit" variant={items.length > 1 ? 'outline' : 'default'} disabled={busy || waiting}>{draft.targetId ? 'Adicionar ao pré' : 'Cadastrar pré'}</Button>{items.length > 1 && <Button type="button" disabled={busy} onClick={() => save(true)}>Cadastrar lote ({items.length})</Button>}</div></div>
        {items.length > 1 && <div className="import-file-navigation"><Button type="button" variant="ghost" size="sm" disabled={active === 0} onClick={() => selectItem(active - 1)}><ChevronLeft size={15} />Documento anterior</Button><span>{active + 1} / {items.length}</span><Button type="button" variant="ghost" size="sm" disabled={active === items.length - 1} onClick={() => selectItem(active + 1)}>Próximo documento<ChevronRight size={15} /></Button></div>}
      </form>}
    </div>
  </DialogContent></Dialog>;
}
