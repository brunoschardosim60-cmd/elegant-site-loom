import { useEffect, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Clock3, FileText, Package, Trash2, Truck, Undo2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Manifest } from '@/lib/conference';
import { formatManifestDate, manifestAgeLabel, manifestReferenceDate, normalizeIssueDate } from '@/lib/manifest-date';

type Props = {
  manifests: Manifest[];
  query: string;
  focusedManifest: { id: string } | null;
  age: (manifest: Manifest) => number;
  now?: string;
  onToggleDocument: (manifest: Manifest, id: string, received: boolean) => void;
  onIssueDateChange?: (manifestId: string, issueDate: string | undefined) => void;
  onDeleteManifest?: (id: string) => void;
};

const driverKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('');
const countVolumes = (manifests: Manifest[], pendingOnly = false) => manifests.reduce((total, manifest) => total + manifest.documents.reduce((sum, doc) => sum + (!pendingOnly || !doc.received ? doc.volumes : 0), 0), 0);

/** Keeps every driver's manifests together while opening only the table being used. */
export function DriverManifestList({ manifests, query, focusedManifest, age, now, onToggleDocument, onIssueDateChange, onDeleteManifest }: Props) {
  const [expanded, setExpanded] = useState(manifests[0]?.id ?? '');
  const [editingDate, setEditingDate] = useState<{ id: string; value: string; error?: string } | null>(null);
  const groups = new Map<string, { driver: string; manifests: Manifest[] }>();
  for (const manifest of manifests) {
    const key = driverKey(manifest.driver);
    const group = groups.get(key);
    if (group) group.manifests.push(manifest);
    else groups.set(key, { driver: manifest.driver, manifests: [manifest] });
  }
  const firstManifestId = manifests[0]?.id ?? '';
  const expandedVisible = !expanded || manifests.some(manifest => manifest.id === expanded);
  useEffect(() => { if (!expandedVisible) setExpanded(firstManifestId); }, [expandedVisible, firstManifestId]);
  useEffect(() => { if (query.trim()) setExpanded(firstManifestId); }, [query, firstManifestId]);
  useEffect(() => { if (focusedManifest) setExpanded(focusedManifest.id); }, [focusedManifest]);

  return <div className="driver-list">
    <div className="driver-list-caption"><UserRound size={14} /><span>{groups.size} {groups.size === 1 ? 'motorista' : 'motoristas'} · {manifests.length} {manifests.length === 1 ? 'pré-manifesto' : 'pré-manifestos'}</span><span>Selecione um pré para conferir</span></div>
    {[...groups.entries()].map(([key, group]) => {
      const pendingCount = group.manifests.reduce((sum, manifest) => sum + manifest.documents.filter(doc => !doc.received).length, 0);
      const documentCount = group.manifests.reduce((sum, manifest) => sum + manifest.documents.length, 0);
      const pendingVolumes = countVolumes(group.manifests, true);
      const plates = [...new Set(group.manifests.map(manifest => manifest.plate))];
      return <section className="driver-group" aria-label={`Pré-manifestos de ${group.driver}`} key={key}>
        <header className="driver-group-heading">
          <div className="driver-group-avatar" aria-hidden="true">{initials(group.driver)}</div>
          <div className="driver-group-person"><h3>{group.driver}</h3><p><Truck size={12} /><span>{plates.join(' · ')}</span><span className="driver-group-separator">/</span><span>{group.manifests.length} {group.manifests.length === 1 ? 'pré' : 'prés'}</span></p></div>
          <div className={`driver-group-totals ${pendingCount ? '' : 'driver-group-done'}`}>
            <span><FileText size={13} /><strong>{pendingCount || documentCount}</strong> {pendingCount ? pendingCount === 1 ? 'CTC pendente' : 'CTCs pendentes' : documentCount === 1 ? 'CTC conferido' : 'CTCs conferidos'}</span>
            <span><Package size={13} /><strong>{pendingCount ? pendingVolumes : countVolumes(group.manifests)}</strong> {pendingCount ? 'vols. a conferir' : 'vols. conferidos'}</span>
          </div>
        </header>
        <div className="driver-manifests">
          {group.manifests.map(manifest => {
            const count = manifest.documents.filter(doc => doc.received).length;
            const remaining = manifest.documents.length - count;
            const pendingVols = countVolumes([manifest], true);
            const days = age(manifest);
            const dateLabel = normalizeIssueDate(manifest.issueDate ?? '') ? 'Emissão' : 'Cadastro';
            const open = expanded === manifest.id;
            const tableId = `driver-documents-${manifest.id}`;
            const percent = manifest.documents.length ? Math.round(count / manifest.documents.length * 100) : 0;
            return <article className={`driver-manifest ${open ? 'driver-manifest-open' : ''}`} key={manifest.id}>
              <button type="button" className="driver-manifest-trigger" aria-expanded={open} aria-controls={tableId} aria-label={`${open ? 'Recolher' : 'Abrir'} documentos do pré ${manifest.id}`} onClick={() => setExpanded(open ? '' : manifest.id)}>
                <div className="driver-manifest-title"><span className="driver-manifest-id">{manifest.id}</span><span className="driver-manifest-date">{dateLabel} {formatManifestDate(manifestReferenceDate(manifest))}<span>·</span><span className="plate">{manifest.plate}</span></span></div>
                <div className="driver-manifest-summary"><span className={`status-badge ${manifest.finishedAt ? 'badge-success' : days >= 2 ? 'badge-warning' : 'badge-pending'}`}>{manifest.finishedAt ? <Check size={11} /> : <Clock3 size={11} />}{manifest.finishedAt ? 'Finalizado' : manifestAgeLabel(manifest, now)}</span><span className="driver-manifest-missing">{remaining ? <><strong>{remaining}</strong> {remaining === 1 ? 'CTC' : 'CTCs'} · <strong>{pendingVols}</strong> vols. faltando</> : <>{count} {count === 1 ? 'CTC conferido' : 'CTCs conferidos'}</>}</span></div>
                <ChevronDown className="driver-manifest-chevron" size={17} aria-hidden="true" />
              </button>
              {(onIssueDateChange || onDeleteManifest) && <div className="driver-manifest-date-editor px-4 pb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                {onIssueDateChange && (editingDate?.id === manifest.id ? <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={event => {
                  event.preventDefault();
                  const value = editingDate.value.trim();
                  const issueDate = normalizeIssueDate(value);
                  if (value && !issueDate) { setEditingDate({ ...editingDate, error: 'Informe uma data válida.' }); return; }
                  onIssueDateChange(manifest.id, issueDate);
                  setEditingDate(null);
                }}>
                  <label htmlFor={`issue-date-${manifest.id}`} className="text-[11px] text-muted-foreground">Emissão do pré</label>
                  <Input id={`issue-date-${manifest.id}`} aria-label={`Data de emissão do pré ${manifest.id}`} type="date" min="1000-01-01" max="9999-12-31" className="h-8 w-40 text-xs" value={editingDate.value} onChange={event => setEditingDate({ id: manifest.id, value: event.target.value })} />
                  <Button type="submit" size="sm" className="h-8">Salvar data</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setEditingDate(null)}>Cancelar</Button>
                  <span className="basis-full text-[10px] text-muted-foreground">Use a data impressa no cabeçalho. Em branco, a idade usa o cadastro.</span>
                  {editingDate.error && <span role="alert" className="basis-full text-xs text-destructive">{editingDate.error}</span>}
                </form> : <button type="button" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" aria-label={`Editar data do pré ${manifest.id}`} onClick={() => setEditingDate({ id: manifest.id, value: normalizeIssueDate(manifest.issueDate ?? '') ?? '' })}><CalendarDays size={12} />Editar data do pré</button>)}
                {onDeleteManifest && <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-1 text-[10px] text-muted-foreground hover:text-destructive [&_svg]:size-3" aria-label={`Excluir pré ${manifest.id}`} onClick={() => onDeleteManifest(manifest.id)}><Trash2 size={12} aria-hidden="true" />Excluir pré</Button>}
              </div>}
              <div className="driver-manifest-progress"><div className="driver-manifest-progress-label"><span>{count} de {manifest.documents.length} CTCs conferidos</span><strong>{percent}%</strong></div><div className="driver-manifest-progress-track" role="progressbar" aria-label={`Conferência de ${group.driver} · ${manifest.id}`} aria-valuenow={count} aria-valuemin={0} aria-valuemax={manifest.documents.length}><span style={{ width: `${percent}%` }} /></div></div>
              {open && <div className="driver-document-panel" id={tableId}>
                <table className="document-table driver-document-table"><thead><tr><th>CTC / Cliente</th><th>Nota fiscal</th><th>Vols.</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{[...manifest.documents].sort((a, b) => Number(a.received) - Number(b.received)).map(doc => <tr key={doc.id} className={doc.received ? 'received-row' : ''}>
                  <td className="ctc-number" data-label="CTC / Cliente">{doc.ctc}{doc.client && <span className="driver-document-client">{doc.client}</span>}{doc.recipient && <span className="driver-document-recipient">Para: {doc.recipient}</span>}</td><td data-label="Nota fiscal">{doc.nf}</td><td data-label="Volumes">{doc.volumes}</td><td data-label="Status"><span className={`status-badge ${doc.received ? 'badge-success' : 'badge-pending'}`}>{doc.received ? <Check size={10} /> : <Clock3 size={10} />}{doc.received ? 'Conferido' : 'Pendente'}</span></td><td><Button variant="ghost" size="icon" className="document-action text-muted-foreground" title={doc.received ? `Desfazer CTC ${doc.ctc}` : `Marcar CTC ${doc.ctc} como recebido`} aria-label={doc.received ? `Desfazer CTC ${doc.ctc}` : `Marcar CTC ${doc.ctc} como recebido`} onClick={() => onToggleDocument(manifest, doc.id, !doc.received)}>{doc.received ? <Undo2 /> : <Check />}</Button></td>
                </tr>)}</tbody></table>
              </div>}
            </article>;
          })}
        </div>
      </section>;
    })}
  </div>;
}
