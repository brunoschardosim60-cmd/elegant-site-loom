export type DocumentItem = { id: string; cte: string; nf: string; volumes: number; received: boolean; receivedAt?: string | undefined };
export type Manifest = { id: string; driver: string; plate: string; date: string; documents: DocumentItem[]; finishedAt?: string | undefined };
export type Reading = { kind: 'cte'; number: string; key?: string } | { kind: 'nfe' } | { kind: 'invalid' };

export function parseReading(value: string): Reading {
  const code = value.trim().replace(/\s/g, '');
  if (!/^\d+$/.test(code)) return { kind: 'invalid' };
  if (code.length <= 9) return { kind: 'cte', number: String(Number(code)) };
  if (code.length !== 44) return { kind: 'invalid' };
  if (code.slice(20, 22) === '55') return { kind: 'nfe' };
  if (code.slice(20, 22) !== '57') return { kind: 'invalid' };
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) { sum += Number(code[i]) * weight; weight = weight === 9 ? 2 : weight + 1; }
  const remainder = sum % 11;
  const digit = remainder < 2 ? 0 : 11 - remainder;
  if (digit !== Number(code[43])) return { kind: 'invalid' };
  return { kind: 'cte', number: String(Number(code.slice(25, 34))), key: code };
}

export function findMatches(manifests: Manifest[], reading: Extract<Reading, { kind: 'cte' }>) {
  return manifests.flatMap(manifest => manifest.documents.filter(doc => doc.cte.length === 44 ? doc.cte === reading.key : String(Number(doc.cte)) === reading.number).map(doc => ({ manifest, doc })));
}

export function setReceived(manifest: Manifest, id: string, received: boolean, now: string): Manifest {
  const documents = manifest.documents.map(doc => doc.id === id ? { ...doc, received, receivedAt: received ? now : undefined } : doc);
  return { ...manifest, documents, finishedAt: documents.every(doc => doc.received) ? now : undefined };
}

export const demoManifests: Manifest[] = [];

export type PreDraft = { id: string; plate: string; ctes: string[] };

/** Extracts PRE fields from OCR text. CT-es only from explicit 44-digit keys or "CT-e" labelled numbers. */
export function parsePreText(text: string): PreDraft {
  const upper = text.toUpperCase();
  const id = upper.match(/DI\s?\d{8,12}/)?.[0].replace(/\s/g, '') ?? '';
  const plate = upper.match(/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/)?.[0].replace('-', '') ?? '';
  const ctes = new Set<string>();
  for (const m of text.replace(/(\d)[ .](?=\d)/g, '$1').matchAll(/\d{44}/g)) { const r = parseReading(m[0]); if (r.kind === 'cte') ctes.add(m[0]); }
  for (const m of upper.matchAll(/CT-?E\s*(?:N[º°O.]*)?\s*[:#]?\s*(\d{4,9})\b/g)) if (m[1]) ctes.add(String(Number(m[1])));
  return { id, plate, ctes: [...ctes] };
}