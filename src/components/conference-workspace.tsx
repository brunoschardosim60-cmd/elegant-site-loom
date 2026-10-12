import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, ArrowRight, Barcode, Check, CheckCheck, ChevronRight, CircleCheck, Clock3, FileCheck2, FileText, Inbox, Layers, PanelLeftClose, PanelLeftOpen, Plus, Search, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { demoManifests, findMatches, parseReading, setReceived, type Manifest } from '@/lib/conference';

import { ManifestImportDialog } from './manifest-import-dialog';
import { DriverManifestList } from './driver-manifest-list';
import { applyImports, type ImportDraft } from '@/lib/manifest-import';
import type { ConferenceState } from '@/lib/conference-state';
import { compareManifestDates, formatManifestDate, manifestAgeDays, manifestAgeLabel, manifestReferenceDate, normalizeIssueDate } from '@/lib/manifest-date';

type View = 'pending' | 'missing' | 'finished' | 'issues';
type Activity = { id: number; title: string; description: string; time: string; warning?: boolean | undefined };
type Notice = { id: number; text: string; warning?: boolean };
const initialActivity: Activity[] = [];
const titles: Record<View, string> = { pending: 'Conferência de documentos', missing: 'Pendências de conferência', finished: 'Pré-manifestos finalizados', issues: 'Ocorrências da conferência' };
const timeNow = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function ConferenceWorkspace({ initialState, onSnapshot, accountEmail }: { initialState?: ConferenceState; onSnapshot?: (state: ConferenceState) => void; accountEmail?: string } = {}) {
  const [manifests, setManifests] = useState<Manifest[]>(initialState?.manifests ?? demoManifests);
  const current = useRef(manifests);
  const [view, setView] = useState<View>('pending');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [focusedManifest, setFocusedManifest] = useState<{ id: string } | null>(null);
  const [filter, setFilter] = useState('all');
  const [code, setCode] = useState('');
  const scanner = useRef<HTMLInputElement>(null);
  const [activity, setActivity] = useState(initialState?.activity ?? initialActivity);
  const [issues, setIssues] = useState<Activity[]>(initialState?.issues ?? []);
  const snapshotCallback = useRef(onSnapshot);
  snapshotCallback.current = onSnapshot;
  useEffect(() => { snapshotCallback.current?.({ manifests, activity, issues }); }, [manifests, activity, issues]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [now, setNow] = useState('2026-10-09T09:36:00');
  const [prefillId, setPrefillId] = useState('');
  const sequence = useRef(Math.max(10, ...(initialState?.activity ?? []).map(item => item.id), ...(initialState?.issues ?? []).map(item => item.id)));
  const [pdfBusy, setPdfBusy] = useState(false);
  async function exportPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const { exportConferencePdf } = await import('@/lib/conference-pdf');
      await exportConferencePdf({ manifests, issues, view, query, filter });
    } catch { notify('Não foi possível gerar o PDF. Tente novamente.', true); }
    finally { setPdfBusy(false); }
  }
  useEffect(() => {
    const refreshClock = () => setNow(new Date().toISOString());
    const refreshVisibleClock = () => { if (document.visibilityState === 'visible') refreshClock(); };
    refreshClock();
    const timer = window.setInterval(refreshClock, 60000);
    document.addEventListener('visibilitychange', refreshVisibleClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleClock);
    };
  }, []);
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
      if (manifest) { setFocusedManifest({ id: manifest.id }); setView(manifest.finishedAt ? 'finished' : 'pending'); setQuery(manifest.id); notify(`Pré de ${manifest.driver.split(' ')[0]} localizado`); }
      else { setPrefillId(input.toUpperCase()); setNewOpen(true); }
      return;
    }
    const reading = parseReading(input);
    if (reading.kind === 'nfe') { notify('Isso é uma NF-e. Bipe somente o CTC.', true); log('NF-e não aceita', 'Bipe o código de barras do CTC.', true); return; }
    if (reading.kind === 'invalid') { notify('Código inválido. Confira e bipe o CTC novamente.', true); return; }
    const matches = findMatches(current.current, reading);
    if (!matches.length) { setBlocked(`O CTC ${reading.number} não está em nenhum pré-manifesto cadastrado.`); log('CTC sem pré-manifesto', `CTC ${reading.number}`, true); return; }
    if (matches.length > 1) { setBlocked(`O CTC ${reading.number} aparece em mais de um pré. Confira o vínculo desse CTC nos pré-manifestos antes de continuar.`); log('CTC com vínculo ambíguo', `CTC ${reading.number}`, true); return; }
    const match = matches[0];
    if (!match) return;
    const { manifest, doc } = match;
    setFocusedManifest({ id: manifest.id });
    if (doc.received) { notify(`CTC ${reading.number} já foi bipado${doc.receivedAt ? ` às ${new Date(doc.receivedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.`, true); log('CTC já conferido', `CTC ${reading.number} · ${manifest.driver.split(' ')[0]}`, true); return; }
    const changed = setReceived(manifest, doc.id, true, new Date().toISOString());
    update(current.current.map(item => item.id === manifest.id ? changed : item));
    notify(changed.finishedAt ? `Pré de ${manifest.driver.split(' ')[0]} finalizado!` : `CTC ${reading.number} · ${manifest.driver.split(' ')[0]} · conferido`);
    log(changed.finishedAt ? 'Pré-manifesto finalizado' : `CTC ${reading.number} conferido`, manifest.driver);
  }
  function toggleDocument(manifest: Manifest, id: string, received: boolean) {
    const latest = current.current.find(item => item.id === manifest.id);
    const doc = latest?.documents.find(item => item.id === id);
    if (!latest || !doc || doc.received === received) return;
    const changed = setReceived(latest, id, received, new Date().toISOString());
    update(current.current.map(item => item.id === latest.id ? changed : item));
    log(received ? 'Documento conferido manualmente' : 'Conferência desfeita', latest.driver);
    if (changed.finishedAt) notify(`Pré de ${latest.driver.split(' ')[0]} finalizado!`);
  }
  function changeIssueDate(manifestId: string, value: string | undefined) {
    const issueDate = normalizeIssueDate(value ?? '');
    if (value?.trim() && !issueDate) { notify('Confira a data de emissão do pré.', true); return; }
    const manifest = current.current.find(item => item.id === manifestId);
    if (!manifest || manifest.issueDate === issueDate) return;
    update(current.current.map(item => {
      if (item.id !== manifestId) return item;
      const changed = { ...item };
      if (issueDate) changed.issueDate = issueDate;
      else delete changed.issueDate;
      return changed;
    }));
    log('Data de emissão atualizada', `${manifestId} · ${issueDate ? formatManifestDate(issueDate) : 'idade pelo cadastro'}`);
    notify(onSnapshot ? 'Data atualizada. Confira o status de salvamento.' : 'Data de emissão atualizada.');
  }
  const pending = manifests.filter(item => !item.finishedAt);
  const finished = manifests.filter(item => item.finishedAt);
  const documents = manifests.flatMap(item => item.documents);
  const missing = pending.flatMap(item => item.documents).filter(doc => !doc.received);
  const age = (manifest: Manifest) => manifestAgeDays(manifest, now);
  const missingRows = pending.flatMap(manifest => manifest.documents.filter(doc => !doc.received).map(doc => ({ manifest, doc, days: age(manifest) }))).filter(({ manifest, doc }) => `${manifest.id} ${manifest.driver} ${manifest.plate} ${doc.ctc} ${doc.nf} ${doc.client || ''} ${doc.recipient || ''}`.toLowerCase().includes(query.toLowerCase())).filter(({ days }) => filter !== 'old' || days >= 2).sort((a, b) => filter === 'new' ? compareManifestDates(b.manifest, a.manifest) : compareManifestDates(a.manifest, b.manifest));
  const visible = (view === 'finished' ? finished : pending).filter(item => `${item.driver} ${item.id} ${item.plate} ${item.documents.map(doc => `${doc.ctc} ${doc.nf} ${doc.client || ''} ${doc.recipient || ''}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())).filter(item => filter !== 'old' || age(item) >= 2).sort((a, b) => filter === 'new' ? compareManifestDates(b, a) : compareManifestDates(a, b));

  function importDrafts(drafts: ImportDraft[]) {
    const result = applyImports(current.current, drafts, new Date().toISOString());
    if (result.ok) {
      update(result.manifests); setView('pending'); setQuery(''); setFilter('all');
      log('Documentos importados', `${drafts.length} foto(s) / pré(s) revisados`);
      notify(onSnapshot ? `${drafts.length} cadastro(s) adicionados. Confira o status de salvamento.` : `${drafts.length} cadastro(s) concluídos.`);
    }
    return result;
  }
  const navigation = [
    { view: 'pending' as const, label: 'Conferência', count: pending.length, Icon: ScanLine },
    { view: 'missing' as const, label: 'Pendências', count: missing.length, Icon: Clock3 },
    { view: 'finished' as const, label: 'Finalizados', count: finished.length, Icon: FileCheck2 },
    { view: 'issues' as const, label: 'Ocorrências', count: issues.length, Icon: TriangleAlert },
  ];
  return <TooltipProvider delayDuration={150}><div className={`workspace workspace-refreshed ${sidebarCollapsed ? 'workspace-sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="workspace-sidebar-heading"><div className="brand" aria-label="confere."><Layers className="brand-symbol" size={30} strokeWidth={2.6} /> <span className="workspace-sidebar-brand-name">confere<span className="text-sidebar-primary">.</span></span></div><Button type="button" variant="ghost" size="icon" className="workspace-sidebar-toggle" aria-label={sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} title={sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} aria-expanded={!sidebarCollapsed} aria-controls="workspace-navigation" onClick={() => setSidebarCollapsed(collapsed => !collapsed)}>{sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></div>
      <p className="brand-subtitle text-sidebar-muted text-[10px] mt-2 ml-10">Cada documento no seu lugar.</p>
      <div className="sidebar-label">Operação</div>
      <nav id="workspace-navigation" aria-label="Navegação principal">
        {navigation.map(({ view: target, label, count, Icon }) => <Tooltip key={target}><TooltipTrigger asChild><Button variant="ghost" className={`nav-item ${view === target ? 'active' : ''}`} aria-label={label} aria-current={view === target ? 'page' : undefined} onClick={() => { setView(target); if (target !== 'issues') setQuery(''); }}><Icon /><span className="workspace-sidebar-nav-label">{label}</span>{(target !== 'issues' || count > 0) && <span className="nav-count">{count}</span>}</Button></TooltipTrigger><TooltipContent side="right" sideOffset={12} hidden={!sidebarCollapsed} className="workspace-sidebar-tooltip">{label}{target !== 'issues' || count > 0 ? ` · ${count}` : ''}</TooltipContent></Tooltip>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="session-note"><div className="flex items-center gap-2 text-sidebar-foreground font-semibold mb-1"><ShieldCheck size={14} /> {accountEmail ? 'Sua conta' : 'Sessão de demonstração'}</div>{accountEmail ? `Cadastros vinculados a ${accountEmail}. Rascunhos são descartados ao fechar.` : 'Os dados são temporários e serão reiniciados ao atualizar a página.'}</div>
        <div className="profile" title={accountEmail || 'Bruno Schardosim · Operação · Porto Alegre'}><div className="avatar">BS</div><div className="workspace-sidebar-profile-text"><div className="text-[11px] font-semibold">Bruno Schardosim</div><div className="text-[9px] text-sidebar-muted mt-1">Operação · Porto Alegre</div></div><span className="workspace-sidebar-profile-chevron ml-auto text-sidebar-muted"><ChevronRight size={14} /></span></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="topbar-trail"><span>Operação</span><ChevronRight size={12} /><span className="text-foreground font-semibold">{view === 'pending' ? 'Conferência' : view === 'missing' ? 'Pendências' : view === 'finished' ? 'Finalizados' : 'Ocorrências'}</span></div><div className="topbar-meta"><span className="date-meta">{new Date(now).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span><span><i className="online-dot" />Sessão ativa</span></div></header>
      <div className="page-content">
        <div className="page-heading"><div><h1>{titles[view]}</h1><p className="subtitle">{view === 'pending' ? 'Seus prés separados por motorista. Confira os CTCs e acompanhe o que falta.' : view === 'missing' ? 'Todos os CTCs que ainda faltam voltar, do mais antigo ao mais novo.' : view === 'finished' ? 'Documentos recebidos. Conferência concluída.' : 'Documentos que precisam de atenção.'}</p></div><Button onClick={() => { setPrefillId(''); setNewOpen(true); }}><Plus size={15} /> Novo pré<span className="hidden sm:inline">-manifesto</span></Button></div>
        <div className="metric-grid">
          {[{ label: 'Pré-manifestos em aberto', value: pending.length, caption: 'Aguardando documentos', icon: Layers, color: '' }, { label: 'Documentos pendentes', value: missing.length, caption: `${missing.reduce((sum, doc) => sum + doc.volumes, 0)} volumes a conferir`, icon: FileText, color: '' }, { label: 'Documentos conferidos', value: documents.filter(doc => doc.received).length, caption: 'Recebidos e identificados', icon: CircleCheck, color: 'text-success' }, { label: 'Pré-manifestos finalizados', value: finished.length, caption: 'Todos os documentos recebidos', icon: CheckCheck, color: 'text-primary' }].map(metric => <div className="metric" key={metric.label}><div className="metric-label">{metric.label}<metric.icon /></div><div className={`metric-value ${metric.color}`}>{String(metric.value).padStart(2, '0')}</div><div className="metric-caption">{metric.caption}</div></div>)}
        </div>
        <section className="scanner-band" aria-label="Leitor de CTC"><div className="scanner-symbol"><ScanLine size={29} strokeWidth={1.6} /></div><div className="scanner-copy"><h2>Pronto para a próxima leitura</h2><p><span className="online-dot" />Aguardando CTC</p></div><form className="scan-form" onSubmit={scan}><Barcode /><input ref={scanner} aria-label="Código do CTC" className="scan-input" placeholder="Bipe ou digite o código do CTC…" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" disabled={!!blocked || newOpen} /><Button type="submit" size="sm" disabled={!code.trim() || !!blocked || newOpen}>Conferir <ArrowRight size={13} /></Button></form></section>
        <div className="content-grid"><section>
          <div className="section-heading"><h2 className="mr-auto">{view === 'pending' ? 'Pré-manifestos em aberto' : view === 'missing' ? 'CTCs pendentes' : view === 'finished' ? 'Conferências concluídas' : 'Ocorrências'}<span className="section-count">{view === 'issues' ? issues.length : view === 'missing' ? missingRows.length : visible.length}</span></h2><Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={pdfBusy} className="text-[11px]">{pdfBusy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}{pdfBusy ? 'Gerando PDF…' : 'PDF'}</Button></div>
          {view !== 'issues' && <div className="list-tools"><label className="search-wrap"><Search /><input aria-label="Buscar pré-manifesto" placeholder="Pré, motorista, placa, CTC, NF ou cliente" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filtrar pré-manifestos" className="filter-select" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Mais antigos primeiro</option><option value="new">Mais recentes</option><option value="old">Há 2 dias ou mais</option></select></div>}
          <div className="manifest-list">
            {view === 'missing' ? missingRows.length ? <div className="manifest-card pending-table-wrap"><table className="document-table pending-table" aria-label="CTCs pendentes"><thead><tr><th>CTC</th><th>Pré / Motorista</th><th>NF</th><th>Vols.</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{missingRows.map(({ manifest, doc, days }) => <tr key={doc.id}><td className="ctc-number" data-label="CTC / Cliente">{doc.ctc}{doc.client && <span className="block text-muted-foreground text-[10px] font-sans mt-1">{doc.client}</span>}</td><td data-label="Pré / Motorista"><span className="block font-semibold">{manifest.id}</span><span className="text-muted-foreground">{manifest.driver} · <span className="plate">{manifest.plate}</span></span><span className="block text-muted-foreground text-[10px] mt-1">{normalizeIssueDate(manifest.issueDate ?? '') ? 'Emissão' : 'Cadastro'} {formatManifestDate(manifestReferenceDate(manifest))}</span></td><td className="text-muted-foreground" data-label="Nota fiscal">{doc.nf}</td><td data-label="Volumes">{doc.volumes}</td><td data-label="Status"><span className={`status-badge ${days >= 2 ? 'badge-warning' : 'badge-pending'}`}><Clock3 size={10} />{manifestAgeLabel(manifest, now)}</span></td><td data-label="Ações"><Button variant="ghost" size="icon" className="document-action text-muted-foreground" aria-label={`Marcar CTC ${doc.ctc} como recebido`} onClick={() => toggleDocument(manifest, doc.id, true)}><Check /></Button></td></tr>)}</tbody></table></div> : <div className="empty-state"><CheckCheck /><h3>Nada pendente</h3><p className="text-xs mt-2">{query ? 'Nenhum resultado para essa busca.' : 'Todos os CTCs cadastrados já foram conferidos.'}</p></div> : view === 'issues' ? issues.length ? issues.map(issue => <div className="manifest-card p-5 flex gap-3" key={issue.id}><TriangleAlert className="text-warning shrink-0" size={19} /><div><h3 className="font-semibold text-xs">{issue.title}</h3><p className="text-muted-foreground text-xs mt-2">{issue.description}</p><p className="text-muted-foreground text-[10px] mt-2">{issue.time}</p></div></div>) : <div className="empty-state"><ShieldCheck /><h3>Nenhuma ocorrência</h3><p className="text-xs mt-2">Tudo certo com as leituras desta sessão.</p></div> : visible.length ? <DriverManifestList manifests={visible} query={query} focusedManifest={focusedManifest} age={age} now={now} onToggleDocument={toggleDocument} onIssueDateChange={changeIssueDate} /> : <div className="empty-state"><Inbox /><h3>{view === 'finished' ? 'Nenhum pré finalizado' : 'Nenhum pré pendente'}</h3><p className="text-xs mt-2">{query ? 'Nenhum resultado para essa busca.' : 'A lista está em dia.'}</p></div>}
          </div>
        </section><aside className="activity-panel"><div className="activity-heading">Últimas atividades <span className="live-label"><i className="online-dot" />Ao vivo</span></div><div className="activity-date">Hoje</div><div className="activity-list">{activity.slice(0, 5).map(item => <div className="activity-item" key={item.id}><div className={`activity-icon ${item.warning ? 'warning' : ''}`}>{item.warning ? <TriangleAlert /> : item.title.includes('finalizado') ? <CheckCheck /> : item.title.includes('adicionado') ? <Plus /> : <Check />}</div><div><div className="activity-title">{item.title}</div><div className="activity-description">{item.description}</div><div className="activity-time">{item.time}</div></div></div>)}</div><div className="daily-summary"><h3>Resumo da sessão</h3><div className="summary-line"><span>Documentos recebidos</span><strong>{documents.filter(doc => doc.received).length}</strong></div><div className="summary-line"><span>Pré-manifestos concluídos</span><strong>{finished.length}</strong></div><div className="summary-line"><span>Ocorrências registradas</span><strong>{issues.length}</strong></div><div className="flex gap-2 text-success text-[10px] mt-5 items-center"><ShieldCheck size={13} />{issues.length ? 'Confira as ocorrências' : 'Nenhuma ocorrência nesta sessão'}</div></div></aside></div>
        <footer className="page-footer"><span className="flex gap-1.5 items-center"><ShieldCheck size={12} /> {accountEmail ? 'Cadastros na sua conta · confira o status de salvamento' : 'Dados temporários · reiniciam ao atualizar a página'}</span><span>confere. <span className="mx-2">/</span> Controle de retorno de documentos</span></footer>
      </div>
    </main>
    <div className="toast-stack" aria-live="polite">{notices.map(notice => <div className={`scan-toast ${notice.warning ? 'warning' : ''}`} key={notice.id}>{notice.warning ? <TriangleAlert className="text-warning shrink-0" size={17} /> : <CircleCheck className="text-success shrink-0" size={17} />}<span>{notice.text}</span></div>)}</div>
    <Dialog open={!!blocked} onOpenChange={open => { if (!open) setBlocked(null); }}><DialogContent><DialogHeader><div className="text-warning mb-2"><TriangleAlert size={30} /></div><DialogTitle>Este CTC precisa de atenção</DialogTitle><DialogDescription className="pt-2">{blocked}</DialogDescription></DialogHeader><p className="text-xs text-muted-foreground">Confira o documento e os CTCs cadastrados antes de continuar.</p><Button onClick={() => setBlocked(null)}>Entendido, continuar <ArrowRight /></Button></DialogContent></Dialog>
    {newOpen && <ManifestImportDialog open onOpenChange={open => { setNewOpen(open); if (!open) setPrefillId(''); }} manifests={manifests} onCreate={importDrafts} initialId={prefillId} />}

  </div></TooltipProvider>;
}
