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

/** Fixes the digit confusions OCR commonly makes inside numeric fields. */
const toDigits = (v: string) => v.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/\D/g, '');

/**
 * Extracts PRE fields from OCR text, tolerating common OCR noise (D1/DL for DI, spaced plates, "CTE"/"CT E" labels).
 * CT-es only come from valid 44-digit keys or "CT-e" labelled numbers; CTC/internal numbers are never used.
 */
export function parsePreText(text: string): PreDraft {
  const upper = text.toUpperCase();
  const idMatch = upper.match(/\bD\s?[I1L|]\s?[-:.]?\s?([0-9OQIL|SB]{8,12})\b/);
  const idDigits = idMatch?.[1] ? toDigits(idMatch[1]) : '';
  const id = idDigits.length >= 8 ? `DI${idDigits}` : '';
  const plateMatch = upper.match(/\b([A-Z]{3})[\s-]?([0-9OIL])\s?([A-Z0-9])\s?([0-9OIL])\s?([0-9OIL])\b/);
  const plate = plateMatch ? `${plateMatch[1]}${toDigits(plateMatch[2]!)}${plateMatch[3]}${toDigits(plateMatch[4]!)}${toDigits(plateMatch[5]!)}` : '';
  const ctes = new Set<string>();
  // Only complete numeric runs are keys; never take a 44-digit substring from a longer run.
  for (const m of text.matchAll(/\d(?:[\s.\-]*\d)*/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length !== 44) continue;
    const r = parseReading(digits);
    if (r.kind === 'cte') ctes.add(digits);
  }
  for (const m of upper.matchAll(/\bC\s?T\s?[-–.]?\s?E\b\.?\s*(?:N[º°O.]*)?\s*[:#.\-]?\s*([0-9OIL]{4,9})\b/g)) {
    const n = m[1] ? toDigits(m[1]) : '';
    if (n.length >= 4) ctes.add(String(Number(n)));
  }
  return { id, plate, ctes: [...ctes] };
}
