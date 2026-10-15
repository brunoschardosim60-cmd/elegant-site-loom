import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { activityTimestamp, matchesConferenceSearch } from './conference-display';
import type { Manifest } from './conference';
import { compareManifestDates, formatManifestDate, manifestAgeDays, manifestAgeLabel, normalizeIssueDate } from './manifest-date';
import { selectTrackingRows, type TrackingStatus } from './ctc-tracking';

type ReportIssue = { title: string; description: string; time: string; at?: string | undefined };
type ReportView = 'pending' | 'missing' | 'finished' | 'issues' | 'tracking';
export type ConferencePdfInput = { manifests: Manifest[]; issues: ReportIssue[]; view: ReportView; query?: string; filter?: string; trackingStatus?: TrackingStatus; generatedAt?: Date };
const labels: Record<ReportView, string> = { pending: 'Manifestos em aberto', missing: 'CTCs pendentes', finished: 'Manifestos finalizados', issues: 'Ocorrências da conferência', tracking: 'Rastreamento de CTCs' };
const ink: [number, number, number] = [23, 43, 64];
const blue: [number, number, number] = [0, 73, 124];
const muted: [number, number, number] = [92, 107, 120];
const line: [number, number, number] = [217, 226, 232];
const clean = (value: string | undefined) => (value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').trim();
const field = (value: string | undefined) => clean(value) || '-';
const date = (value: string | Date | undefined, withTime = false) => {
  if (!withTime && typeof value === 'string' && normalizeIssueDate(value)) return formatManifestDate(value);
  const parsed = value instanceof Date ? value : new Date(value ?? '');
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } as const : {}) }).format(parsed);
};

/** Export the same scope as the active view, including its search and age filter. */
export function selectConferenceReport(input: ConferencePdfInput) {
  const query = input.query ?? '';
  const now = (input.generatedAt ?? new Date()).getTime();
  if (input.view === 'tracking') {
    const groups = new Map<string, Manifest>();
    for (const { manifest, doc } of selectTrackingRows(input.manifests, { query: input.query ?? '', filter: input.filter ?? 'all', status: input.trackingStatus ?? 'all', now })) {
      const group = groups.get(manifest.id) ?? { ...manifest, documents: [] };
      group.documents.push(doc); groups.set(manifest.id, group);
    }
    return { manifests: [...groups.values()], issues: [] };
  }
  const manifests = input.view === 'issues' ? [] : input.manifests.filter(manifest => input.view === 'finished' ? Boolean(manifest.finishedAt) : !manifest.finishedAt)
    .filter(manifest => input.filter !== 'old' || manifestAgeDays(manifest, now) >= 2)
    .flatMap(manifest => {
      if (input.view === 'missing') {
        const documents = manifest.documents.filter(doc => !doc.received && matchesConferenceSearch(manifest, query, doc));
        return documents.length ? [{ ...manifest, documents }] : [];
      }
      return matchesConferenceSearch(manifest, query) ? [manifest] : [];
    }).sort((a, b) => input.filter === 'new' ? compareManifestDates(b, a) : compareManifestDates(a, b));
  return { manifests, issues: input.view === 'issues' ? input.issues : [] };
}

/** Vector PDF: readable when printed, with repeated table headers on long prés. */
export function createConferencePdf(input: ConferencePdfInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const selected = selectConferenceReport({ ...input, generatedAt });
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `confere. - ${labels[input.view]}`, subject: 'Conferência de CTCs e pré-manifestos', author: 'confere.', creator: 'confere.' });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const available = width - margin * 2;
  const continuationTop = 12;
  let cursor = 34;
  const text = (value: string, x: number, y: number, size = 9, bold = false, color = ink) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color); pdf.text(clean(value), x, y);
  };
  // Report branding and generation metadata belong only on the first page.
  // Continuations reserve space only for the current driver/manifest and columns.
  const drawFirstHeader = () => {
    text('confere.', margin, 16, 18, true, blue);
    text(labels[input.view], margin, 23, 11, true);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...muted);
    pdf.text(`Emitido em ${date(generatedAt, true)}`, width - margin, 15, { align: 'right' });
    pdf.text('Horário de Brasília', width - margin, 20, { align: 'right' });
    pdf.setFillColor(...blue); pdf.rect(margin, 27, available, .6, 'F');
  };
  const newPage = () => { pdf.addPage(); cursor = continuationTop; };
  const reserve = (space: number) => { if (cursor + space > height - 14) newPage(); };
  drawFirstHeader();
  const documents = selected.manifests.flatMap(manifest => manifest.documents);
  const metrics = input.view === 'issues'
    ? [['OCORRÊNCIAS', String(selected.issues.length)]]
    : [['MANIFESTOS', String(selected.manifests.length)], ['CTCs', String(documents.length)], ['PENDENTES', String(documents.filter(doc => !doc.received).length)], ['CONFERIDOS', String(documents.filter(doc => doc.received).length)], ['VOLUMES', String(documents.reduce((sum, doc) => sum + doc.volumes, 0))]];
  const cardWidth = (available - 4 * (metrics.length - 1)) / metrics.length;
  metrics.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + 4);
    pdf.setFillColor(242, 246, 249); pdf.roundedRect(x, cursor - 2, cardWidth, 15, 1.5, 1.5, 'F');
    text(label!, x + 3, cursor + 3, 7, true, muted); text(value!, x + 3, cursor + 10, 13, true, blue);
  });
  cursor += 18;
  const filters = [input.view !== 'issues' && clean(input.query) ? `Busca: ${clean(input.query)}` : '', input.view !== 'issues' && input.filter === 'old' ? 'Há 2 dias ou mais pela emissão; sem emissão, pelo cadastro' : '', input.view === 'tracking' && input.trackingStatus && input.trackingStatus !== 'all' ? `Status: ${input.trackingStatus === 'received' ? 'Conferidos' : 'Pendentes'}` : ''].filter(Boolean).join(' | ');
  if (filters) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    const lines = pdf.splitTextToSize(filters, available);
    text(lines.join('\n'), margin, cursor, 8, false, muted); cursor += lines.length * 4 + 5;
  }

  if (input.view === 'issues') {
    if (selected.issues.length) {
      autoTable(pdf, { startY: cursor, margin: { left: margin, right: margin, top: continuationTop, bottom: 14 },
        head: [['Data / hora', 'Ocorrência', 'Detalhe']], body: selected.issues.map(issue => [field(activityTimestamp(issue)), field(issue.title), field(issue.description)]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, textColor: ink, overflow: 'linebreak', lineColor: line, lineWidth: .1 },
        headStyles: { fillColor: blue, textColor: [255, 255, 255], fontStyle: 'bold' }, alternateRowStyles: { fillColor: [245, 248, 250] },
        columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 65 } }, rowPageBreak: 'avoid',
      });
    } else text('Nenhuma ocorrência registrada.', margin, cursor + 8, 11, false, muted);
  } else if (!selected.manifests.length) {
    text('Nenhum manifesto encontrado nesta seleção.', margin, cursor + 8, 11, false, muted);
  } else {
    const groups = new Map<string, Manifest[]>();
    for (const manifest of selected.manifests) {
      const key = clean(manifest.driver).replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR') || 'MOTORISTA NÃO INFORMADO';
      groups.set(key, [...(groups.get(key) ?? []), manifest]);
    }
    for (const [driver, manifests] of groups) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
      const driverLines = pdf.splitTextToSize(driver, available) as string[];
      const driverHeight = driverLines.length * 4.5 + 2;
      const drawDriver = () => { text(driverLines.join('\n'), margin, cursor, 10, true, blue); cursor += driverHeight; };
      reserve(driverHeight + 36); drawDriver();
      for (const manifest of manifests) {
        const header = (continuation = false) => {
          pdf.setFillColor(233, 240, 245); pdf.roundedRect(margin, cursor - 1, available, 17, 1.5, 1.5, 'F');
          text(`${field(manifest.id)}${continuation ? ' (continuação)' : ''}`, margin + 3, cursor + 5, 10, true);
          const issueDate = normalizeIssueDate(manifest.issueDate ?? '');
          const timing = [issueDate ? `${/^\d{8,12}$/.test(manifest.id) ? 'Manifestado em' : 'Emissão'} ${formatManifestDate(issueDate)}` : '', `Cadastro ${date(manifest.date)}`, !manifest.finishedAt ? manifestAgeLabel(manifest, generatedAt) : ''].filter(Boolean).join(' | ');
          text(`Placa ${field(manifest.plate)} | ${timing}`, margin + 3, cursor + 12, 8, false, muted);
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...blue);
          const pending = manifest.documents.filter(doc => !doc.received).length;
          pdf.text(`${manifest.documents.length} CTCs | ${manifest.documents.reduce((sum, doc) => sum + doc.volumes, 0)} volumes | ${pending ? `${pending} pendente(s)` : 'Todos conferidos'}`, width - margin - 3, cursor + 5, { align: 'right' });
          if (manifest.finishedAt) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...muted); pdf.text(`Finalizado em ${date(manifest.finishedAt, true)}`, width - margin - 3, cursor + 12, { align: 'right' }); }
        };
        if (cursor + 36 > height - 14) { newPage(); drawDriver(); }
        header(); cursor += 19;
        const tableStartPage = pdf.getCurrentPageInfo().pageNumber;
        autoTable(pdf, {
          startY: cursor, margin: { left: margin, right: margin, top: continuationTop + driverHeight + 19, bottom: 14 },
          head: [['CTC', 'NF / série', 'Vols.', 'Cliente / laboratório', 'Destinatário', 'Situação']],
          body: manifest.documents.map(doc => [field(doc.ctc), field(doc.nf), String(doc.volumes), field(doc.client), field(doc.recipient), doc.received ? `Conferido${doc.receivedAt ? `\n${date(doc.receivedAt, true)}` : ''}` : 'Pendente']),
          styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: ink, valign: 'middle', overflow: 'linebreak', lineColor: line, lineWidth: .1 },
          headStyles: { fillColor: blue, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
          alternateRowStyles: { fillColor: [245, 248, 250] },
          columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold' }, 1: { cellWidth: 28 }, 2: { cellWidth: 13, halign: 'center' }, 3: { cellWidth: 71 }, 4: { cellWidth: available - 178 }, 5: { cellWidth: 38 } },
          rowPageBreak: 'avoid', showHead: 'everyPage',
          willDrawPage: () => {
            if (pdf.getCurrentPageInfo().pageNumber > tableStartPage) { cursor = continuationTop; drawDriver(); header(true); }
          },
          didParseCell: data => {
            if (data.section === 'body' && data.column.index === 5) data.cell.styles.textColor = manifest.documents[data.row.index]?.received ? [22, 105, 77] : [146, 91, 17];
          },
        });
        cursor = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      }
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setDrawColor(...line); pdf.line(margin, height - 10, width - margin, height - 10);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...muted);
    pdf.text(`${page} / ${pages}`, width - margin, height - 6, { align: 'right' });
  }
  return pdf;
}

export async function exportConferencePdf(input: ConferencePdfInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const filename = `confere-${input.view === 'pending' ? 'abertos' : input.view === 'missing' ? 'pendencias' : input.view === 'finished' ? 'finalizados' : input.view === 'tracking' ? 'rastreamento' : 'ocorrencias'}-${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(generatedAt)}.pdf`;
  createConferencePdf({ ...input, generatedAt }).save(filename);
}
