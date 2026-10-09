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

export const demoManifests: Manifest[] = [
  { id: 'DI0060186918', driver: 'Luciano Teixeira Duarte', plate: 'IYA7J31', date: '2026-10-08T16:59:41', documents: [
    { id: 'l1', cte: '365569', nf: '1127276-1', volumes: 27, received: false },
    { id: 'l2', cte: '365506', nf: '1126736-1', volumes: 45, received: true, receivedAt: '2026-10-09T08:43:00' },
    { id: 'l3', cte: '365505', nf: '1126683-1', volumes: 18, received: false },
  ] },
  { id: 'DI0060186942', driver: 'Luiz Kleber da Silva', plate: 'JBT2E84', date: '2026-10-07T14:20:00', documents: [
    { id: 'k1', cte: '365710', nf: '1128012-1', volumes: 12, received: true },
    { id: 'k2', cte: '365711', nf: '1128018-1', volumes: 8, received: false },
    { id: 'k3', cte: '365712', nf: '1128031-1', volumes: 16, received: false },
    { id: 'k4', cte: '365713', nf: '1128046-1', volumes: 24, received: true },
  ] },
  { id: 'DI0060186975', driver: 'Carlos Eduardo Martins', plate: 'IVQ8A12', date: '2026-10-09T07:30:00', documents: [
    { id: 'c1', cte: '365820', nf: '1128105-1', volumes: 10, received: false },
    { id: 'c2', cte: '365821', nf: '1128110-1', volumes: 18, received: false },
  ] },
  { id: 'DI0060186820', driver: 'Roberto Alves de Souza', plate: 'JAK4F90', date: '2026-10-08T08:00:00', finishedAt: '2026-10-09T08:12:00', documents: [
    { id: 'r1', cte: '365410', nf: '1127010-1', volumes: 21, received: true },
    { id: 'r2', cte: '365411', nf: '1127012-1', volumes: 9, received: true },
  ] },
];