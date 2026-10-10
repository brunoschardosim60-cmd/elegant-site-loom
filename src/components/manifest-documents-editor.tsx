import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ManifestDraftRow = { ctc: string; nf: string; volumes: string };

export function ManifestDocumentsEditor({ rows, onChange, selectedIndex, onSelect, disabled }: {
  rows: ManifestDraftRow[]; onChange: (rows: ManifestDraftRow[]) => void;
  selectedIndex: number; onSelect: (index: number) => void; disabled?: boolean;
}) {
  const index = Math.min(selectedIndex, rows.length - 1);
  const row = rows[index]!;
  return <section className="border-t border-border pt-4">
    <h3 className="text-xs font-semibold mb-2">CTCs esperados</h3>
    {rows.length > 1 && <label className="form-field mb-3">CTC {index + 1} de {rows.length}
      <select aria-label="Selecionar CTC" className="rounded-md border border-border bg-background p-2" disabled={disabled} value={index} onChange={event => onSelect(Number(event.target.value))}>
        {rows.map((item, i) => <option key={i} value={i}>{i + 1}. {item.ctc || 'Novo CTC'}</option>)}
      </select>
    </label>}
    <div className="new-document-row">
      {(['ctc', 'nf', 'volumes'] as const).map(field => <label className="form-field" key={field}>{field === 'ctc' ? 'CTC' : field === 'nf' ? 'NF-série' : 'Vols.'}
        <input aria-label={field === 'ctc' ? 'CTC' : field === 'nf' ? 'NF-série' : 'Volumes'} required={field !== 'nf'} disabled={disabled} value={row[field]} inputMode={field === 'nf' ? 'text' : 'numeric'} maxLength={field === 'ctc' ? 10 : undefined} type={field === 'volumes' ? 'number' : 'text'} min={field === 'volumes' ? 1 : undefined} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item))} />
      </label>)}
      <Button type="button" variant="ghost" size="icon" className="w-7" aria-label="Remover CTC" disabled={disabled || rows.length === 1} onClick={() => { onChange(rows.filter((_, i) => i !== index)); onSelect(Math.max(0, index - 1)); }}><Trash2 /></Button>
    </div>
    <Button type="button" variant="ghost" size="sm" className="text-primary mt-3" disabled={disabled} onClick={() => { onChange([...rows, { ctc: '', nf: '', volumes: '1' }]); onSelect(rows.length); }}><Plus /> Adicionar CTC</Button>
  </section>;
}
