import { AlertCircle, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ManifestDraftRow = { ctc: string; nf: string; volumes: string; client?: string; recipient?: string; review?: string[] };

export function ManifestDocumentsEditor({ rows, onChange, selectedIndex, onSelect, disabled }: {
  rows: ManifestDraftRow[]; onChange: (rows: ManifestDraftRow[]) => void;
  selectedIndex: number; onSelect: (index: number) => void; disabled?: boolean;
}) {
  const index = Math.max(0, Math.min(selectedIndex, rows.length - 1));
  const row = rows[index];
  const flagged = rows.filter(item => item.review?.length).length;
  if (!row) return null;
  return <section className="import-ctc-editor">
    <div className="import-section-title"><span>2</span><h4>CTCs esperados</h4><span className="import-ctc-count">{rows.length} {rows.length === 1 ? 'documento' : 'documentos'}</span>{flagged > 0 && <span className="import-review-count">{flagged} a conferir</span>}</div>
    <div className="import-ctc-navigation">
      {rows.length > 1 ? <label className="form-field import-ctc-select">CTC {index + 1} de {rows.length}<select aria-label="Selecionar CTC" disabled={disabled} value={index} onChange={event => onSelect(Number(event.target.value))}>{rows.map((item, i) => <option key={i} value={i}>{i + 1}. {item.ctc || 'Novo CTC'}{item.nf ? ` · NF ${item.nf}` : ''}{item.review?.length ? ' · Conferir' : ''}</option>)}</select></label> : <div className="import-single-ctc">CTC 1 de 1<span>Dados do documento</span></div>}
      {rows.length > 1 && <div className="import-ctc-arrows"><Button type="button" variant="outline" size="sm" disabled={disabled || index === 0} onClick={() => onSelect(index - 1)}><ChevronLeft /><span>CTC anterior</span></Button><Button type="button" variant="outline" size="sm" disabled={disabled || index === rows.length - 1} onClick={() => onSelect(index + 1)}><span>Próximo CTC</span><ChevronRight /></Button></div>}
    </div>
    {!!row.review?.length && <div className="import-alert warning import-row-review" role="status"><AlertCircle size={18} /><div><strong>Confira este CTC na foto</strong>{row.review.map(message => <p key={message}>{message}</p>)}</div></div>}
    <div className="import-ctc-fields">
      {(['ctc', 'nf', 'volumes'] as const).map(field => <label className="form-field" key={field}>{field === 'ctc' ? 'CTC' : field === 'nf' ? 'NF-série' : 'Volumes'}<input aria-label={field === 'ctc' ? 'CTC' : field === 'nf' ? 'NF-série' : 'Volumes'} required={field !== 'nf'} disabled={disabled} value={row[field]} inputMode={field === 'nf' ? 'text' : 'numeric'} placeholder={field === 'ctc' ? '10 dígitos' : field === 'nf' ? 'Número-série' : '1'} maxLength={field === 'ctc' ? 10 : undefined} type={field === 'volumes' ? 'number' : 'text'} min={field === 'volumes' ? 1 : undefined} step={field === 'volumes' ? 1 : undefined} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item))} /></label>)}
      <Button type="button" variant="ghost" size="icon" className="import-remove-ctc" aria-label="Remover CTC" title="Remover este CTC" disabled={disabled || rows.length === 1} onClick={() => { onChange(rows.filter((_, i) => i !== index)); onSelect(Math.max(0, index - 1)); }}><Trash2 /></Button>
    </div>
    <div className="import-client-fields">{(['client', 'recipient'] as const).map(field => <label className="form-field" key={field}>{field === 'client' ? 'Cliente / laboratório (remetente)' : 'Destinatário'}<input aria-label={field === 'client' ? 'Cliente / laboratório' : 'Destinatário'} disabled={disabled} value={row[field] ?? ''} placeholder={field === 'client' ? 'Nome impresso no documento' : 'Nome do destinatário'} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item))} /></label>)}</div>
    <div className="import-ctc-bottom"><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { onChange([...rows, { ctc: '', nf: '', volumes: '1' }]); onSelect(rows.length); }}><Plus />Adicionar CTC</Button>{flagged > 0 && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { const next = rows.findIndex((item, i) => i > index && item.review?.length); onSelect(next >= 0 ? next : rows.findIndex(item => item.review?.length)); }}>Ir para campo sinalizado<ChevronRight size={14} /></Button>}</div>
  </section>;
}
