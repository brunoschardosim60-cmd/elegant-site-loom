import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Loader2, Sparkles, ArrowDownToLine, ArrowRight, Barcode, Check, CheckCheck, ChevronRight, CircleCheck, Clock3, FileCheck2, FileText, Inbox, Layers, Plus, Search, ScanLine, ShieldCheck, Undo2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { demoManifests, findMatches, parseReading, setReceived, type Manifest } from '@/lib/conference';
import { analyzeDivergence } from '@/lib/divergence.functions';

import { ManifestDocumentsEditor, type ManifestDraftRow } from './manifest-documents-editor';

type View = 'pending' | 'finished' | 'issues';
type Activity = { id: number; title: string; description: string; time: string; warning?: boolean };
type Notice = { id: number; text: string; warning?: boolean };
const initialActivity: Activity[] = [];
const titles: Record<View, string> = { pending: 'Conferência de documentos', finished: 'Pré-manifestos finalizados', issues: 'Ocorrências da conferência' };
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(word => word[0]).join('');
const timeNow = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function ConferenceWorkspace() {
  const [manifests, setManifests] = useState<Manifest[]>(demoManifests);
  const current = useRef(manifests);
  const [view, setView] = useState<View>('pending');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [code, setCode] = useState('');
  const scanner = useRef<HTMLInputElement>(null);
  const [activity, setActivity] = useState(initialActivity);
  const [issues, setIssues] = useState<Activity[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [now, setNow] = useState('2026-10-09T09:36:00');
  const [formError, setFormError] = useState('');
  const [newRows, setNewRows] = useState<ManifestDraftRow[]>([{ ctc: '', nf: '', volumes: '1' }]);
  const [selectedRow, setSelectedRow] = useState(0);
  const sequence = useRef(10);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrProgress, setOcrProgress] = useState('');
  const [draft, setDraft] = useState({ id: '', plate: '', driver: '' });
  const [divOpen, setDivOpen] = useState(false);
  const [div, setDiv] = useState({ ctc: '', nf: '', manifest: '', volumesExpected: '', volumesReceived: '', description: '' });
  const [divBusy, setDivBusy] = useState(false);
  const [divResult, setDivResult] = useState<{ text?: string; error?: string } | null>(null);
  async function readPhoto(file: File | undefined) {
    if (!file) return;
    setOcrBusy(true); setFormError(''); setOcrText('');
    try {
      const { readPrePhoto } = await import('@/lib/photo-ocr');
      const { text, pre } = await readPrePhoto(file, setOcrProgress);
      setOcrText(text.trim());
      setDraft(d => ({ ...d, id: pre.id || d.id, plate: pre.plate || d.plate, driver: pre.driver || d.driver }));
      if (pre.documents.length) setNewRows(pre.documents);
      else if (pre.ctcs.length) setNewRows(pre.ctcs.map(ctc => ({ ctc, nf: '', volumes: '' })));
      setSelectedRow(0);
      setFormError(pre.documents.length ? `Foto lida: ${pre.documents.length} CTC(s) importados. Revise os dados antes de cadastrar.` : pre.id || pre.plate || pre.ctcs.length ? `Foto lida: ${pre.ctcs.length} CTC(s) encontrados. Revise antes de cadastrar.` : 'Confira o texto lido ou preencha os dados manualmente.');
    } catch { setFormError('Falha ao ler a foto. Digite os dados manualmente.'); }
    finally { setOcrBusy(false); }
  }
  async function submitDivergence(event: FormEvent) {
    event.preventDefault();
    if (!div.description.trim()) return;
    setDivBusy(true); setDivResult(null);
    try { const r = await analyzeDivergence({ data: div }); setDivResult(r.ok ? { text: r.text } : { error: r.error }); if (r.ok) log('Divergência analisada', `CTC ${div.ctc || '—'} · ${div.description.slice(0, 60)}`, true); }
    catch { setDivResult({ error: 'Não foi possível analisar agora.' }); }
    finally { setDivBusy(false); }
  }
  async function exportPdf() {
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const pdf = new jsPDF();
    const done = manifests.flatMap(m => m.documents.filter(d => d.received).map(d => [m.id, m.driver, d.ctc, d.nf, String(d.volumes)]));
    const open = manifests.flatMap(m => m.documents.filter(d => !d.received).map(d => [m.id, m.driver, d.ctc, d.nf, String(d.volumes)]));
    pdf.setFontSize(16); pdf.text('Relatório de conferência de CTC', 14, 18);
    pdf.setFontSize(10); pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 25);
    const status = !manifests.length ? 'Sem pré-manifestos' : open.length ? `Em aberto — ${open.length} pendência(s)` : 'Concluída — todos os CTC conferidos';
    pdf.text(`Status final: ${status}`, 14, 31);
    pdf.text(`Pré-manifestos: ${manifests.length} · Finalizados: ${manifests.filter(m => m.finishedAt).length} · Ocorrências: ${issues.length}`, 14, 37);
    const head = [['Pré', 'Motorista', 'CTC', 'NF', 'Vols.']];
    autoTable(pdf, { startY: 44, head: [['CTC conferidos (' + done.length + ')', '', '', '', '']], body: [], theme: 'plain' });
    autoTable(pdf, { head, body: done.length ? done : [['—', '', '', '', '']], headStyles: { fillColor: [0, 61, 165] } });
    autoTable(pdf, { head: [['Pendências (' + open.length + ')', '', '', '', '']], body: [], theme: 'plain' });
    autoTable(pdf, { head, body: open.length ? open : [['—', '', '', '', '']], headStyles: { fillColor: [200, 120, 0] } });
    if (issues.length) { autoTable(pdf, { head: [['Ocorrências', 'Detalhe', 'Hora']], body: issues.map(i => [i.title, i.description, i.time]), headStyles: { fillColor: [90, 90, 90] } }); }
    pdf.save('conferencia.pdf');
  }
  useEffect(() => { setNow(new Date().toISOString()); }, []);
  useEffect(() => { if (!blocked && !newOpen) scanner.current?.focus(); }, [blocked, newOpen]);

  function update(next: Manifest[]) { current.current = next; setManifests(next); }
  function log(title: string, description: string, warning = false) {
    const entry = { id: ++sequence.current, title, description, time: timeNow(), warning };
    setActivity(items => [entry, ...items].slice(0, 20));
    if (warning) setIssues(items => [entry, ...items]);
  }
  function notify(text: string, warning = false) {
    const id = ++sequence.current;
    setNotices(items => [...items.slice(-2), { id, text, warning }]);
    window.setTimeout(() => setNotices(items => items.filter(item => item.id !== id)), 4000);
  }
  function scan(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || blocked || newOpen) return;
    const input = code.trim();
    setCode('');
    scanner.current?.focus();
    if (/^DI/i.test(input)) {
      const manifest = current.current.find(item => item.id.toUpperCase() === input.toUpperCase());
      if (manifest) { setView(manifest.finishedAt ? 'finished' : 'pending'); setQuery(manifest.id); notify(`Pré de ${manifest.driver.split(' ')[0]} localizado`); }
      else { setFormError(''); setDraft(d => ({ ...d, id: input.toUpperCase() })); setNewOpen(true); }
      return;
    }
    const reading = parseReading(input);
    if (reading.kind === 'nfe') { notify('Isso é uma NF-e. Bipe somente o CTC.', true); log('NF-e não aceita', 'Bipe o código de barras do CTC.', true); return; }
    if (reading.kind === 'invalid') { notify('Código inválido. Confira e bipe o CTC novamente.', true); return; }
    const matches = findMatches(current.current, reading);
    if (!matches.length) { setBlocked(`O CTC ${reading.number} não está em nenhum pré-manifesto cadastrado.`); log('CTC sem pré-manifesto', `CTC ${reading.number}`, true); return; }
    if (matches.length > 1) { setBlocked(`O CTC ${reading.number} aparece em mais de um pré. Cadastre a chave completa para identificar o documento com segurança.`); log('CTC com vínculo ambíguo', `CTC ${reading.number}`, true); return; }
    const match = matches[0];
    if (!match) return;
    const { manifest, doc } = match;
    if (doc.received) { notify(`CTC ${reading.number} já foi bipado${doc.receivedAt ? ` às ${new Date(doc.receivedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.`, true); log('CTC já conferido', `CTC ${reading.number} · ${manifest.driver.split(' ')[0]}`, true); return; }
    const changed = setReceived(manifest, doc.id, true, new Date().toISOString());
    update(current.current.map(item => item.id === manifest.id ? changed : item));
    notify(changed.finishedAt ? `Pré de ${manifest.driver.split(' ')[0]} finalizado!` : `CTC ${reading.number} · ${manifest.driver.split(' ')[0]} · conferido`);
    log(changed.finishedAt ? 'Pré-manifesto finalizado' : `CTC ${reading.number} conferido`, manifest.driver);
  }
  function toggleDocument(manifest: Manifest, id: string, received: boolean) {
    const changed = setReceived(manifest, id, received, new Date().toISOString());
    update(current.current.map(item => item.id === manifest.id ? changed : item));
    log(received ? 'Documento conferido manualmente' : 'Conferência desfeita', manifest.driver);
    if (changed.finishedAt) notify(`Pré de ${manifest.driver.split(' ')[0]} finalizado!`);
  }
  const pending = manifests.filter(item => !item.finishedAt);
  const finished = manifests.filter(item => item.finishedAt);
  const documents = manifests.flatMap(item => item.documents);
  const missing = pending.flatMap(item => item.documents).filter(doc => !doc.received);
  const age = (date: string) => Math.max(0, Math.floor((new Date(now).getTime() - new Date(date).getTime()) / 86400000));
  const visible = (view === 'finished' ? finished : pending).filter(item => `${item.driver} ${item.id} ${item.plate} ${item.documents.map(doc => doc.ctc).join(' ')}`.toLowerCase().includes(query.toLowerCase())).filter(item => filter !== 'old' || age(item.date) >= 2).sort((a, b) => filter === 'new' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));

  function addManifest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = String(data.get('id')).trim().toUpperCase();
    if (current.current.some(item => item.id === id)) { setFormError('Esse pré-manifesto já está cadastrado.'); return; }
    const validRows = newRows.map(row => ({ ...row, reading: parseReading(row.ctc) }));
    if (validRows.some(row => row.reading.kind !== 'ctc' || !Number.isInteger(Number(row.volumes)) || Number(row.volumes) < 1)) { setFormError('Informe CTCs válidos e volumes inteiros maiores que zero.'); return; }
    const identifiers = validRows.map(row => row.ctc.replace(/\s/g, ''));
    if (new Set(identifiers).size !== identifiers.length) { setFormError('Há um CTC repetido nesta lista.'); return; }
    const manifest: Manifest = { id, driver: String(data.get('driver')).trim(), plate: String(data.get('plate')).trim().toUpperCase(), date: new Date().toISOString(), documents: validRows.map((row, i) => ({ id: `${id}-${i}`, ctc: row.ctc.replace(/\s/g, ''), nf: row.nf.trim() || '—', volumes: Number(row.volumes), received: false })) };
    update([...current.current, manifest]); setView('pending'); setQuery(''); setFilter('all'); setNewOpen(false); setNewRows([{ ctc: '', nf: '', volumes: '1' }]); setSelectedRow(0); setDraft({ id: '', plate: '', driver: '' }); log('Pré-manifesto adicionado', manifest.driver); notify('Pré-manifesto cadastrado. Documentos pendentes.');
  }
  function exportSession() {
    const rows = [['Pré-manifesto', 'Motorista', 'Placa', 'CTC', 'NF', 'Volumes', 'Status'], ...manifests.flatMap(item => item.documents.map(doc => [item.id, item.driver, item.plate, doc.ctc, doc.nf, String(doc.volumes), doc.received ? 'Conferido' : 'Pendente']))];
    const text = '\ufeff' + rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'conferencia.csv'; link.click(); URL.revokeObjectURL(url);
  }

  return <div className="workspace">
    <aside className="sidebar">
      <div className="brand"><Layers className="brand-symbol" size={30} strokeWidth={2.6} /> <span>confere<span className="text-sidebar-primary">.</span></span></div>
      <p className="brand-subtitle text-sidebar-muted text-[10px] mt-2 ml-10">Cada documento no seu lugar.</p>
      <div className="sidebar-label">Operação</div>
      <nav aria-label="Navegação principal">
        <Button variant="ghost" className={`nav-item ${view === 'pending' ? 'active' : ''}`} onClick={() => { setView('pending'); setQuery(''); }}><ScanLine /> Conferência <span className="nav-count">{pending.length}</span></Button>
        <Button variant="ghost" className={`nav-item ${view === 'finished' ? 'active' : ''}`} onClick={() => { setView('finished'); setQuery(''); }}><FileCheck2 /> Finalizados <span className="nav-count">{finished.length}</span></Button>
        <Button variant="ghost" className={`nav-item ${view === 'issues' ? 'active' : ''}`} onClick={() => setView('issues')}><TriangleAlert /> Ocorrências {issues.length > 0 && <span className="nav-count">{issues.length}</span>}</Button>
      </nav>
      <div className="sidebar-bottom">
        <div className="session-note"><div className="flex items-center gap-2 text-sidebar-foreground font-semibold mb-1"><ShieldCheck size={14} /> Sessão de demonstração</div>Os dados são temporários e serão reiniciados ao atualizar a página.</div>
        <div className="profile"><div className="avatar">BS</div><div><div className="text-[11px] font-semibold">Bruno Schardosim</div><div className="text-[9px] text-sidebar-muted mt-1">Operação · Porto Alegre</div></div><span className="ml-auto text-sidebar-muted"><ChevronRight size={14} /></span></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="topbar-trail"><span>Operação</span><ChevronRight size={12} /><span className="text-foreground font-semibold">{view === 'pending' ? 'Conferência' : view === 'finished' ? 'Finalizados' : 'Ocorrências'}</span></div><div className="topbar-meta"><span className="date-meta">{new Date(now).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span><span><i className="online-dot" />Sessão ativa</span></div></header>
      <div className="page-content">
        <div className="page-heading"><div><h1>{titles[view]}</h1><p className="subtitle">{view === 'pending' ? 'Tudo o que saiu. Tudo o que voltou. Sem perder uma nota.' : view === 'finished' ? 'Documentos recebidos. Conferência concluída.' : 'Documentos que precisam de atenção.'}</p></div><Button onClick={() => { setFormError(''); setNewOpen(true); }}><Plus size={15} /> Novo pré<span className="hidden sm:inline">-manifesto</span></Button></div>
        <div className="metric-grid">
          {[{ label: 'Pré-manifestos em aberto', value: pending.length, caption: 'Aguardando documentos', icon: Layers, color: '' }, { label: 'Documentos pendentes', value: missing.length, caption: `${missing.reduce((sum, doc) => sum + doc.volumes, 0)} volumes a conferir`, icon: FileText, color: '' }, { label: 'Documentos conferidos', value: documents.filter(doc => doc.received).length, caption: 'Recebidos e identificados', icon: CircleCheck, color: 'text-success' }, { label: 'Pré-manifestos finalizados', value: finished.length, caption: 'Todos os documentos recebidos', icon: CheckCheck, color: 'text-primary' }].map(metric => <div className="metric" key={metric.label}><div className="metric-label">{metric.label}<metric.icon /></div><div className={`metric-value ${metric.color}`}>{String(metric.value).padStart(2, '0')}</div><div className="metric-caption">{metric.caption}</div></div>)}
        </div>
        <section className="scanner-band" aria-label="Leitor de CTC"><div className="scanner-symbol"><ScanLine size={29} strokeWidth={1.6} /></div><div className="scanner-copy"><h2>Pronto para a próxima leitura</h2><p><span className="online-dot" />Aguardando CTC</p></div><form className="scan-form" onSubmit={scan}><Barcode /><input ref={scanner} aria-label="Código do CTC" className="scan-input" placeholder="Bipe ou digite o código do CTC…" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" disabled={!!blocked || newOpen} /><Button type="submit" size="sm" disabled={!code.trim() || !!blocked || newOpen}>Conferir <ArrowRight size={13} /></Button></form></section>
        <div className="content-grid"><section>
          <div className="section-heading"><h2 className="mr-auto">{view === 'pending' ? 'Pré-manifestos em aberto' : view === 'finished' ? 'Conferências concluídas' : 'Ocorrências'}<span className="section-count">{view === 'issues' ? issues.length : visible.length}</span></h2><Button variant="ghost" size="sm" onClick={exportSession} className="text-muted-foreground text-[10px]"><ArrowDownToLine size={12} /> CSV</Button><Button variant="outline" size="sm" onClick={exportPdf} className="text-[11px]"><FileText size={12} /> PDF</Button><Button size="sm" onClick={() => { setDivResult(null); setDivOpen(true); }} className="text-[11px]"><Sparkles size={12} /> Divergência</Button></div>
          {view !== 'issues' && <div className="list-tools"><label className="search-wrap"><Search /><input aria-label="Buscar pré-manifesto" placeholder="Buscar motorista, placa ou pré-manifesto" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filtrar pré-manifestos" className="filter-select" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Mais antigos primeiro</option><option value="new">Mais recentes</option><option value="old">Há 2 dias ou mais</option></select></div>}
          <div className="manifest-list">
            {view === 'issues' ? issues.length ? issues.map(issue => <div className="manifest-card p-5 flex gap-3" key={issue.id}><TriangleAlert className="text-warning shrink-0" size={19} /><div><h3 className="font-semibold text-xs">{issue.title}</h3><p className="text-muted-foreground text-xs mt-2">{issue.description}</p><p className="text-muted-foreground text-[10px] mt-2">{issue.time}</p></div></div>) : <div className="empty-state"><ShieldCheck /><h3>Nenhuma ocorrência</h3><p className="text-xs mt-2">Tudo certo com as leituras desta sessão.</p></div> : visible.length ? visible.map(manifest => {
              const count = manifest.documents.filter(doc => doc.received).length;
              const days = age(manifest.date);
              return <article className="manifest-card" key={manifest.id}>
                <div className="manifest-head"><div className="driver-avatar">{initials(manifest.driver)}</div><div className="flex-1 min-w-0"><h3 className="driver-name">{manifest.driver}</h3><div className="manifest-meta"><span>{manifest.id}</span><span>·</span><span className="plate">{manifest.plate}</span><span>·</span><span>{new Date(manifest.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span></div></div><span className={`status-badge ${manifest.finishedAt ? 'badge-success' : days >= 2 ? 'badge-warning' : 'badge-pending'}`}>{manifest.finishedAt ? <Check size={11} /> : <Clock3 size={10} />}{manifest.finishedAt ? 'Finalizado' : days === 0 ? 'Hoje' : `Há ${days} ${days === 1 ? 'dia' : 'dias'}`}</span></div>
                <div className="manifest-progress"><div className="progress-label"><span><strong>{count}</strong> de {manifest.documents.length} documentos conferidos</span><strong>{Math.round(count / manifest.documents.length * 100)}%</strong></div><div className="progress-track" role="progressbar" aria-label={`Conferência de ${manifest.driver}`} aria-valuenow={count} aria-valuemin={0} aria-valuemax={manifest.documents.length}>{manifest.documents.map(doc => <span key={doc.id} className={`progress-segment ${doc.received ? 'done' : ''}`} />)}</div></div>
                <table className="document-table"><thead><tr><th>CTC</th><th>Nota fiscal</th><th>Vols.</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{manifest.documents.map(doc => <tr key={doc.id} className={doc.received ? 'received-row' : ''}><td className="ctc-number">{doc.ctc}</td><td className="text-muted-foreground">{doc.nf}</td><td className="text-muted-foreground">{doc.volumes}</td><td><span className={`status-badge ${doc.received ? 'badge-success' : 'badge-pending'}`}>{doc.received ? <Check size={10} /> : <Clock3 size={10} />}{doc.received ? 'Conferido' : 'Pendente'}</span></td><td><Button variant="ghost" size="icon" className="document-action text-muted-foreground" title={doc.received ? `Desfazer CTC ${doc.ctc}` : `Marcar CTC ${doc.ctc} como recebido`} aria-label={doc.received ? `Desfazer CTC ${doc.ctc}` : `Marcar CTC ${doc.ctc} como recebido`} onClick={() => toggleDocument(manifest, doc.id, !doc.received)}>{doc.received ? <Undo2 /> : <Check />}</Button></td></tr>)}</tbody></table>
              </article>;
            }) : <div className="empty-state"><Inbox /><h3>{view === 'finished' ? 'Nenhum pré finalizado' : 'Nenhum pré pendente'}</h3><p className="text-xs mt-2">{query ? 'Nenhum resultado para essa busca.' : 'A lista está em dia.'}</p></div>}
          </div>
        </section><aside className="activity-panel"><div className="activity-heading">Últimas atividades <span className="live-label"><i className="online-dot" />Ao vivo</span></div><div className="activity-date">Hoje</div><div className="activity-list">{activity.slice(0, 5).map(item => <div className="activity-item" key={item.id}><div className={`activity-icon ${item.warning ? 'warning' : ''}`}>{item.warning ? <TriangleAlert /> : item.title.includes('finalizado') ? <CheckCheck /> : item.title.includes('adicionado') ? <Plus /> : <Check />}</div><div><div className="activity-title">{item.title}</div><div className="activity-description">{item.description}</div><div className="activity-time">{item.time}</div></div></div>)}</div><div className="daily-summary"><h3>Resumo da sessão</h3><div className="summary-line"><span>Documentos recebidos</span><strong>{documents.filter(doc => doc.received).length}</strong></div><div className="summary-line"><span>Pré-manifestos concluídos</span><strong>{finished.length}</strong></div><div className="summary-line"><span>Ocorrências registradas</span><strong>{issues.length}</strong></div><div className="flex gap-2 text-success text-[10px] mt-5 items-center"><ShieldCheck size={13} />{issues.length ? 'Confira as ocorrências' : 'Nenhuma divergência nesta sessão'}</div></div></aside></div>
        <footer className="page-footer"><span className="flex gap-1.5 items-center"><ShieldCheck size={12} /> Dados temporários · reiniciam ao atualizar a página</span><span>confere. <span className="mx-2">/</span> Controle de retorno de documentos</span></footer>
      </div>
    </main>
    <div className="toast-stack" aria-live="polite">{notices.map(notice => <div className={`scan-toast ${notice.warning ? 'warning' : ''}`} key={notice.id}>{notice.warning ? <TriangleAlert className="text-warning shrink-0" size={17} /> : <CircleCheck className="text-success shrink-0" size={17} />}<span>{notice.text}</span></div>)}</div>
    <Dialog open={!!blocked} onOpenChange={open => { if (!open) setBlocked(null); }}><DialogContent><DialogHeader><div className="text-warning mb-2"><TriangleAlert size={30} /></div><DialogTitle>Este CTC precisa de atenção</DialogTitle><DialogDescription className="pt-2">{blocked}</DialogDescription></DialogHeader><p className="text-xs text-muted-foreground">Confira o documento e os CTCs cadastrados antes de continuar.</p><Button onClick={() => setBlocked(null)}>Entendido, continuar <ArrowRight /></Button></DialogContent></Dialog>
    <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Novo pré-manifesto</DialogTitle><DialogDescription>Cadastre os dados do pré e os CTCs esperados.</DialogDescription></DialogHeader><form onSubmit={addManifest} className="grid gap-4"><label className="photo-pick"><input type="file" accept="image/*" capture="environment" className="sr-only" disabled={ocrBusy} onChange={e => { void readPhoto(e.target.files?.[0]); e.target.value = ""; }} />{ocrBusy ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} />}<span>{ocrBusy ? ocrProgress || "Lendo a foto do pré…" : "Tirar ou enviar foto do pré"}<small>Leitura no próprio aparelho, sem IA</small></span></label>{ocrText && <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">Texto lido da foto</summary><textarea readOnly className="mt-2 w-full h-32 rounded-md border border-border bg-background p-2 font-mono text-[11px]" value={ocrText} /></details>}<div className="form-grid"><label className="form-field">Número do pré<input name="id" required placeholder="DI0000000000" value={draft.id} onChange={e => setDraft(d => ({ ...d, id: e.target.value }))} /></label><label className="form-field">Placa<input name="plate" required placeholder="ABC1D23" maxLength={8} value={draft.plate} onChange={e => setDraft(d => ({ ...d, plate: e.target.value }))} /></label><label className="form-field col-span-2">Motorista<input name="driver" required placeholder="Nome completo" value={draft.driver} onChange={e => setDraft(d => ({ ...d, driver: e.target.value }))} /></label></div><ManifestDocumentsEditor rows={newRows} onChange={setNewRows} selectedIndex={selectedRow} onSelect={setSelectedRow} disabled={ocrBusy} />{formError && <p className="text-destructive text-xs" role="alert">{formError}</p>}<div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button><Button type="submit" disabled={ocrBusy}><Plus /> Cadastrar pré</Button></div></form></DialogContent></Dialog>
    <Dialog open={divOpen} onOpenChange={setDivOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Registrar divergência</DialogTitle><DialogDescription>Informe os dados do CTC e descreva o problema. A IA aponta inconsistências e sugere a ação.</DialogDescription></DialogHeader><form onSubmit={submitDivergence} className="grid gap-4"><div className="form-grid">{([['ctc', 'CTC', 'numeric'], ['nf', 'Nota fiscal', 'text'], ['manifest', 'Pré-manifesto', 'text'], ['volumesExpected', 'Vols. esperados', 'numeric'], ['volumesReceived', 'Vols. recebidos', 'numeric']] as const).map(([k, l, m]) => <label className="form-field" key={k}>{l}<input inputMode={m} value={div[k]} onChange={e => setDiv(d => ({ ...d, [k]: e.target.value }))} /></label>)}</div><label className="form-field">Descrição da divergência<textarea required rows={4} className="div-text" placeholder="Ex.: chegaram 25 volumes, CTC indica 27; caixa avariada…" value={div.description} onChange={e => setDiv(d => ({ ...d, description: e.target.value }))} /></label><Button type="submit" disabled={divBusy || !div.description.trim()}>{divBusy ? <><Loader2 className="animate-spin" /> Analisando…</> : <><Sparkles /> Analisar divergência</>}</Button></form>{divResult?.error && <p className="text-destructive text-xs" role="alert">{divResult.error}</p>}{divResult?.text && <div className="ai-result">{divResult.text}</div>}</DialogContent></Dialog>
  </div>;
}
