import { describe, expect, it } from 'vitest';
import type { PhotoFields } from '@/lib/photo-fields';
import { needsPhotoVerification, needsVerificationRecheck, reconcilePhotoRead, reconcileThreePhotoReads, verificationSchema } from '@/lib/photo-verification';

const primary = (): PhotoFields & { expectedRows: number; totalVolumes: number } => ({
  kind: 'pre', id: 'DI00123456789', plate: 'ABC1D23', driver: 'JOÃO DA SILVA',
  expectedRows: 2, totalVolumes: 5, ctcs: ['0000000001', '0000000002'],
  documents: [
    { ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LAB A', recipient: 'CLIENTE A', review: [] },
    { ctc: '0000000002', nf: '102-1', volumes: '3', client: 'LAB B', recipient: 'CLIENTE B', review: [] },
  ],
});
const second = () => ({
  kind: 'pre', clockwiseRotation: 90, id: 'DI00123456789', plate: 'ABC1D23', driver: 'JOAO  DA SILVA',
  expectedRows: 2, totalVolumes: 5,
  documents: [ { ctc: '0000000002', nf: '102-1', volumes: '3' }, { ctc: '0000000001', nf: '101-1', volumes: '2' } ],
});
type Metadata = { headerReview: string[]; verification: { status: string; conflicts: number; checkedFields: number } };
const meta = (value: PhotoFields) => value as PhotoFields & Metadata;

describe('independent photo verification', () => {
  it('compares reordered rows by CTC, preserves zeroes and primary names, and ignores accents/whitespace in driver', () => {
    const result = meta(reconcilePhotoRead(primary(), second()));
    expect(result.verification.status).toBe('matched');
    expect(result.verification.conflicts).toBe(0);
    expect(result.verification.checkedFields).toBeGreaterThan(10);
    expect(result.documents).toEqual(primary().documents);
    expect(result.driver).toBe('JOÃO DA SILVA');
    expect(needsVerificationRecheck(result)).toBe(false);
  });
  it('keeps plausible NF, volumes and a valid but differing plate while flagging each conflict', () => {
    const check = second(); check.plate = 'ABC1823'; check.documents[0]!.nf = '999-1'; check.documents[0]!.volumes = '4';
    const result = meta(reconcilePhotoRead(primary(), check));
    expect(result.plate).toBe('ABC1D23');
    expect(result.documents[1]).toMatchObject({ nf: '102-1', volumes: '3', client: 'LAB B' });
    expect(result.documents[1]!.review?.join(' ')).toContain('NF e série divergente no CTC 0000000002');
    expect(result.documents[1]!.review?.join(' ')).toContain('Volumes divergente');
    expect(result.headerReview.join(' ')).toContain('Placa divergente');
    expect(result.verification).toMatchObject({ status: 'review', conflicts: 3 });
  });
  it('recovers only missing/invalid fields on an identified row and flags the recovery', () => {
    const full = primary(); full.documents[0]!.nf = ''; full.documents[0]!.volumes = 'illegible';
    const result = meta(reconcilePhotoRead(full, second()));
    expect(result.documents[0]).toMatchObject({ ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LAB A' });
    expect(result.documents[0]!.review?.join(' ')).toContain('recuperado pela segunda leitura');
    expect(result.verification.status).toBe('review');
    expect(full.documents[0]!.nf).toBe('');
  });
  it('recovers a missing CTC only through a unique exact NF and volume pair, never row index', () => {
    const full = primary(); full.documents[0]!.ctc = '';
    const result = meta(reconcilePhotoRead(full, second()));
    expect(result.documents[0]!.ctc).toBe('0000000001');
    expect(result.documents[0]!.review?.join(' ')).toContain('CTC recuperado');
    const ambiguous = primary(); ambiguous.documents[0]!.ctc = ''; ambiguous.documents[1]!.ctc = '';
    ambiguous.documents[1]!.nf = '101-1'; ambiguous.documents[1]!.volumes = '2';
    expect(reconcilePhotoRead(ambiguous, second()).documents.every(row => row.ctc === '')).toBe(true);
  });
  it('does not merge duplicate secondary CTCs, unexpected rows or fiscal keys into plausible primary rows', () => {
    const check = second(); check.documents[0]!.ctc = '0000000001';
    const result = meta(reconcilePhotoRead(primary(), check));
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]!.nf).toBe('101-1');
    expect(result.headerReview.join(' ')).toContain('repetiu CTCs');
    check.documents[0]!.ctc = '9'.repeat(44);
    expect(meta(reconcilePhotoRead(primary(), check)).headerReview.join(' ')).toContain('CTCs ilegíveis');
    check.documents[0]!.ctc = '0000000999';
    expect(meta(reconcilePhotoRead(primary(), check)).headerReview.join(' ')).toContain('0000000999');
  });
  it('flags disagreement between header counts, totals and table without replacing the primary', () => {
    const check = second(); check.expectedRows = 3; check.totalVolumes = 6; check.driver = 'OUTRO MOTORISTA'; check.id = 'DI00123456788';
    const result = meta(reconcilePhotoRead(primary(), check));
    expect(result.id).toBe('DI00123456789');
    expect(result.driver).toBe('JOÃO DA SILVA');
    expect(result.headerReview.join(' ')).toContain('Quantidade de CTCs divergente');
    expect(result.headerReview.join(' ')).toContain('Total de volumes divergente');
    expect(result.headerReview.join(' ')).toContain('Soma dos volumes (5)');
    expect(result.verification.status).toBe('review');
  });
  it('marks unavailable or malformed independent results without discarding the original data', () => {
    const result = meta(reconcilePhotoRead(primary(), undefined));
    expect(result.documents).toEqual(primary().documents);
    expect(result.verification).toEqual({ status: 'unavailable', checkedFields: 0, conflicts: 0 });
    expect(needsVerificationRecheck(result)).toBe(true);
    expect(verificationSchema.safeParse({ ...second(), clockwiseRotation: 42 }).success).toBe(false);
  });
  it('does not compare pre headers absent on DACTE documents and does not silently accept unknown document type', () => {
    const full = primary(); full.kind = 'dacte'; full.id = ''; full.plate = ''; full.driver = '';
    const check = second(); check.kind = 'dacte'; check.id = ''; check.plate = ''; check.driver = '';
    expect(meta(reconcilePhotoRead(full, check)).verification.status).toBe('matched');
    check.kind = 'unknown';
    expect(meta(reconcilePhotoRead(full, check)).verification.status).toBe('review');
  });
  it('clears a positional plate warning only after a valid independent literal plate confirms it', () => {
    const full = { ...primary(), rawPlate: 'ABCID23', headerReview: ['Placa ajustada por formato. Confira letras e números.'] };
    expect(meta(reconcilePhotoRead(full, second())).headerReview).toEqual([]);
    const check = second(); check.plate = 'ABCID23';
    expect(meta(reconcilePhotoRead(full, check)).headerReview.join(' ')).toContain('ajustada por formato');
    check.plate = 'ABC1823';
    expect(meta(reconcilePhotoRead(full, check)).headerReview.join(' ')).toContain('Placa divergente');
  });
  it('does not spend a third numeric reading on missing names, and never marks an empty table matched', () => {
    const full = primary(); full.documents[0]!.client = ''; full.documents[0]!.review = ['Confira cliente/laboratório', 'Confira destinatário'];
    const result = meta(reconcilePhotoRead(full, second()));
    expect(result.verification.status).toBe('review');
    expect(needsVerificationRecheck(result)).toBe(false);
    full.documents = []; full.ctcs = []; full.expectedRows = 0; full.totalVolumes = 0;
    const check = second(); check.documents = []; check.expectedRows = 0; check.totalVolumes = 0;
    const empty = meta(reconcilePhotoRead(full, check));
    expect(empty.verification.status).toBe('review');
    expect(needsVerificationRecheck(empty)).toBe(true);
  });
  it('keeps conflicting partial cell values instead of treating them as absent evidence', () => {
    const full = primary(); full.documents[0]!.nf = '999'; full.documents[0]!.volumes = '7?';
    const result = meta(reconcilePhotoRead(full, second()));
    expect(result.documents[0]).toMatchObject({ nf: '999', volumes: '7?' });
    expect(result.documents[0]!.review?.join(' ')).toContain('parcial diverge');
    expect(result.verification.conflicts).toBeGreaterThanOrEqual(2);
  });
  it('automatically resolves disputed fields only when both independent checks agree', () => {
    const full = { ...primary(), plate: 'ABC1823', rawPlate: 'ABC1823', id: 'DI00123456788', driver: 'OUTRO MOTORISTA' };
    full.documents[0]!.nf = '999-1'; full.documents[0]!.volumes = '9';
    const result = meta(reconcileThreePhotoReads(full, second(), second()));
    expect(result).toMatchObject({ plate: 'ABC1D23', id: 'DI00123456789', driver: 'JOAO  DA SILVA' });
    expect(result.documents[0]).toMatchObject({ ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LAB A', recipient: 'CLIENTE A' });
    expect(result.verification.status).toBe('matched');
    expect(full.plate).toBe('ABC1823');
    expect(full.documents[0]!.nf).toBe('999-1');
  });
  it('does not use two equally coerced plate guesses as consensus, and retains primary if checks differ', () => {
    const full = primary(); full.plate = 'ABC1823'; full.documents[0]!.nf = '999-1';
    const first = second(); const final = second(); first.plate = 'ABCID23'; final.plate = 'ABCID23';
    first.documents[1]!.nf = '777-1';
    const result = meta(reconcileThreePhotoReads(full, first, final));
    expect(result.plate).toBe('ABC1823');
    expect(result.documents[0]!.nf).toBe('999-1');
    expect(result.verification.status).toBe('review');
  });
  it('resolves agreed header totals and clears their outdated arithmetic warnings without changing CTCs', () => {
    const full = { ...primary(), totalVolumes: 326, headerReview: ['Confira a soma: cabeçalho informa 326 volumes'] };
    full.documents.forEach(row => row.review!.push('Confira a soma: cabeçalho informa 326 volumes'));
    const result = meta(reconcileThreePhotoReads(full, second(), second()));
    expect(result.totalVolumes).toBe(5);
    expect(result.ctcs).toEqual(primary().ctcs);
    expect(result.headerReview).toEqual([]);
    expect(result.verification.status).toBe('matched');
  });
  it('does not claim a complete pre-manifest when neither reading could read header counts or totals', () => {
    const full = primary(); full.expectedRows = 0; full.totalVolumes = 0;
    const check = second(); check.expectedRows = 0; check.totalVolumes = 0;
    const result = meta(reconcilePhotoRead(full, check));
    expect(result.verification.status).toBe('review');
    expect(result.headerReview.join(' ')).toContain('Contagem de CTCs do cabeçalho');
    expect(result.headerReview.join(' ')).toContain('Total de volumes do cabeçalho');
    expect(needsVerificationRecheck(result)).toBe(true);
    expect(result.expectedRows).toBe(0);
    expect(result.totalVolumes).toBe(0);
    expect(meta(reconcileThreePhotoReads(full, check, check)).verification.status).toBe('review');
  });
  it('never marks an unknown document matched even when all three readings say unknown', () => {
    const full = primary(); full.kind = 'unknown';
    const check = second(); check.kind = 'unknown';
    expect(meta(reconcilePhotoRead(full, check)).verification.status).toBe('review');
    expect(meta(reconcileThreePhotoReads(full, check, check)).verification.status).toBe('review');
  });
  it('flags a pre header read only once while retaining its primary counts and totals', () => {
    const check = second(); check.expectedRows = 0; check.totalVolumes = 0;
    const result = meta(reconcilePhotoRead(primary(), check));
    expect(result.verification.status).toBe('review');
    expect(result.headerReview).toEqual(['Quantidade de CTCs não confirmada pela segunda leitura.', 'Total de volumes não confirmado pela segunda leitura.']);
    expect(result.expectedRows).toBe(2);
    expect(result.totalVolumes).toBe(5);
    expect(needsVerificationRecheck(result)).toBe(true);
    expect(meta(reconcileThreePhotoReads(primary(), check, second())).verification.status).toBe('matched');
  });
  it('does not require pre-manifest header count fields absent on a DACTE', () => {
    const full = primary(); full.kind = 'dacte'; full.expectedRows = 0; full.totalVolumes = 0;
    const check = second(); check.kind = 'dacte'; check.expectedRows = 0; check.totalVolumes = 0;
    expect(meta(reconcilePhotoRead(full, check)).verification.status).toBe('matched');
  });
  it('keeps composite name doubts when numeric consensus clears recognized NF/volume notices', () => {
    const full = primary();
    const nameDoubts = ['NF e destinatário ilegíveis', 'Volumes e cliente/laboratório precisam ser conferidos'];
    full.documents[0]!.review = [...nameDoubts, 'NF', 'Confira NF e série', 'volumes', 'Confira volumes'];
    const result = meta(reconcileThreePhotoReads(full, second(), second()));
    expect(result.documents[0]!.review).toEqual(nameDoubts);
    expect(result.documents[0]).toMatchObject({ client: 'LAB A', recipient: 'CLIENTE A' });
    expect(result.verification.status).toBe('review');
  });
  it('checks customer and recipient names by CTC, retaining accents and literal abbreviations', () => {
    const full = primary();
    full.documents[0]!.client = 'LABORATÓRIO A';
    const check = { ...second(), documents: [
      { ctc: '0000000002', nf: '102-1', volumes: '3', client: 'lab b', recipient: 'cliente b' },
      { ctc: '0000000001', nf: '101-1', volumes: '2', client: ' laboratorio   a ', recipient: 'CLIENTE A' },
    ] };
    const result = meta(reconcilePhotoRead(full, check));
    expect(result.verification.status).toBe('matched');
    expect(result.documents).toEqual(full.documents);
    check.documents[0]!.client = 'LABORATÓRIO B';
    check.documents[0]!.recipient = 'OUTRO CLIENTE';
    const differing = meta(reconcilePhotoRead(full, check));
    expect(differing.documents[1]).toMatchObject({ client: 'LAB B', recipient: 'CLIENTE B' });
    expect(differing.documents[1]!.review?.join(' ')).toContain('Cliente/laboratório divergente no CTC 0000000002');
    expect(differing.documents[1]!.review?.join(' ')).toContain('Destinatário divergente');
    expect(differing.verification).toMatchObject({ status: 'review', conflicts: 2 });
  });
  it('recovers absent names only from the matching CTC and flags the recovery', () => {
    const full = primary(); full.documents[0]!.client = ''; full.documents[0]!.recipient = '?';
    const check = { ...second(), documents: [
      { ctc: '0000000002', nf: '102-1', volumes: '3', client: 'LAB B', recipient: 'CLIENTE B' },
      { ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LAB A', recipient: 'CLIENTE A' },
    ] };
    const result = meta(reconcilePhotoRead(full, check));
    expect(result.documents[0]).toMatchObject({ client: 'LAB A', recipient: 'CLIENTE A' });
    expect(result.documents[0]!.review?.filter(message => message.includes('recuperado pela segunda leitura'))).toHaveLength(2);
    expect(result.verification.status).toBe('review');
    expect(full.documents[0]).toMatchObject({ client: '', recipient: '?' });
    check.documents[1]!.ctc = '0000000999';
    expect(reconcilePhotoRead(full, check).documents[0]).toMatchObject({ client: '', recipient: '?' });
  });
  it('flags empty second-read names and clears only a precise notice after a matching name', () => {
    const full = primary();
    full.documents[0]!.review = ['Confira cliente/laboratório', 'Confira destinatário', 'NF e destinatário ilegíveis'];
    const check = { ...second(), documents: [
      { ctc: '0000000002', nf: '102-1', volumes: '3', client: 'LAB B', recipient: '' },
      { ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LAB A', recipient: 'CLIENTE A' },
    ] };
    const result = meta(reconcilePhotoRead(full, check));
    expect(result.documents[0]!.review).toEqual(['NF e destinatário ilegíveis']);
    expect(result.documents[1]!.review?.join(' ')).toContain('Destinatário não confirmado');
    expect(result.documents[1]!.recipient).toBe('CLIENTE B');
    expect(result.verification.status).toBe('review');
    expect(verificationSchema.safeParse(second()).success).toBe(true);
  });
});

describe('economic photo verification decision', () => {
  it('skips a second request only for a complete consistent read and does not mutate it', () => {
    const full = { ...primary(), rawPlate: 'abc-1d23', readingSource: 'gemini' as const };
    const original = structuredClone(full);
    expect(needsPhotoVerification(full)).toBe(false);
    expect(full).toEqual(original);
    full.documents[1]!.nf = full.documents[0]!.nf;
    expect(needsPhotoVerification(full)).toBe(false); // One NF can appear under different CTCs.
  });
  it.each<[string, (full: ReturnType<typeof primary>) => void]>([
    ['unknown document', full => { full.kind = 'unknown'; }],
    ['no document rows', full => { full.documents = []; full.ctcs = []; }],
    ['missing pre number', full => { full.id = ''; }],
    ['invalid pre number', full => { full.id = 'DI123'; }],
    ['missing driver', full => { full.driver = ' '; }],
    ['placeholder driver', full => { full.driver = 'Não informado'; }],
    ['incomplete plate', full => { full.plate = 'ABC1D2'; }],
    ['normalized plate repair', full => { full.rawPlate = 'ABCID23'; }],
    ['punctuation hiding a plate doubt', full => { full.rawPlate = 'ABC1D23?'; }],
    ['CTC fiscal key', full => { full.documents[0]!.ctc = '9'.repeat(44); }],
    ['duplicate CTC', full => { full.documents[1]!.ctc = full.documents[0]!.ctc; }],
    ['inconsistent CTC summary', full => { full.ctcs = ['0000000001']; }],
    ['missing NF', full => { full.documents[1]!.nf = ''; }],
    ['NF without series', full => { full.documents[1]!.nf = '102'; }],
    ['missing volumes', full => { full.documents[1]!.volumes = ''; }],
    ['zero volumes', full => { full.documents[1]!.volumes = '0'; }],
    ['fractional volumes', full => { full.documents[1]!.volumes = '3.5'; }],
    ['unsafe volume integer', full => { full.documents[1]!.volumes = '9007199254740993'; }],
    ['missing laboratory', full => { full.documents[1]!.client = ''; }],
    ['unreadable laboratory placeholder', full => { full.documents[1]!.client = '???'; }],
    ['missing recipient', full => { delete full.documents[1]!.recipient; }],
    ['missing header row count', full => { full.expectedRows = 0; }],
    ['wrong header row count', full => { full.expectedRows = 3; }],
    ['missing header total', full => { full.totalVolumes = 0; }],
    ['wrong header total', full => { full.totalVolumes = 6; }],
    ['invalid header total', full => { full.totalVolumes = Number.NaN; }],
    ['fractional header count', full => { full.expectedRows = 2.1; }],
    ['header review notice', full => { full.headerReview = ['Confira a placa']; }],
    ['row review notice', full => { full.documents[1]!.review = ['Confira remetente']; }],
    ['local OCR source', full => { full.readingSource = 'local'; }],
    ['local fallback result', full => { full.readingFallback = true; }],
    ['previous unavailable verification', full => { full.verification = { status: 'unavailable', checkedFields: 0, conflicts: 0 }; }],
  ])('requests verification for %s, even if the other fields look complete', (_, change) => {
    const full = primary(); change(full);
    expect(needsPhotoVerification(full)).toBe(true);
  });
  it.each(['O', '0', 'I', '1', 'L', 'B', '8'])('rechecks a syntactically valid but ambiguous fifth plate character %s', character => {
    const full = primary(); full.plate = `ABC1${character}23`; full.rawPlate = full.plate;
    expect(needsPhotoVerification(full)).toBe(true);
  });
  it('does not require pre fields or non-existent header totals on a complete DACTE', () => {
    const full = primary(); full.kind = 'dacte'; full.id = ''; full.plate = ''; full.driver = '';
    full.expectedRows = 0; full.totalVolumes = 0;
    expect(needsPhotoVerification(full)).toBe(false);
    full.totalVolumes = 6;
    expect(needsPhotoVerification(full)).toBe(true);
    full.totalVolumes = 0; full.documents[0]!.recipient = '';
    expect(needsPhotoVerification(full)).toBe(true);
  });
});

describe('conservative recovery of omitted photo rows', () => {
  const incomplete = () => {
    const full = primary(); full.documents = [full.documents[0]!]; full.ctcs = [full.documents[0]!.ctc];
    full.headerReview = ['Cabeçalho informa 2 CTCs; foram lidos 1'];
    return full;
  };
  const completeCheck = () => ({ ...second(), documents: primary().documents.map(({ review, ...row }) => row).reverse() });

  it('recovers a complete omitted row under the same confirmed pre, retaining CTC associations and marking review', () => {
    const full = incomplete(); full.documents[0]!.client = 'LÁB A';
    const original = structuredClone(full);
    const result = meta(reconcilePhotoRead(full, completeCheck()));
    expect(result.ctcs).toEqual(['0000000002', '0000000001']);
    expect(result.documents[0]).toMatchObject({ ctc: '0000000002', nf: '102-1', volumes: '3', client: 'LAB B', recipient: 'CLIENTE B' });
    expect(result.documents[1]).toMatchObject({ ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LÁB A' });
    expect(result.documents[0]!.review?.join(' ')).toContain('Linha recuperada pela segunda leitura');
    expect(result.headerReview.join(' ')).toContain('recuperou 1 linha(s)');
    expect(result.verification.status).toBe('review');
    expect(result.verification.conflicts).toBe(0);
    expect(full).toEqual(original);
  });
  it('recovers an initially empty table only when the pre identity and complete second header are confirmed', () => {
    const full = incomplete(); full.documents = []; full.ctcs = [];
    const result = meta(reconcilePhotoRead(full, completeCheck()));
    expect(result.documents).toHaveLength(2);
    expect(result.documents.every(row => row.review?.some(message => message.includes('Linha recuperada')))).toBe(true);
    expect(result.verification.status).toBe('review');
    full.id = '';
    expect(reconcilePhotoRead(full, completeCheck()).documents).toHaveLength(0);
  });
  it('allows missing primary totals to be recovered from a complete coherent secondary table', () => {
    const full = incomplete(); full.expectedRows = 0; full.totalVolumes = 0;
    const result = meta(reconcilePhotoRead(full, completeCheck()));
    expect(result).toMatchObject({ expectedRows: 2, totalVolumes: 5 });
    expect(result.documents).toHaveLength(2);
    expect(result.verification.status).toBe('review');
  });
  it.each<[string, (full: ReturnType<typeof incomplete>, check: ReturnType<typeof completeCheck>) => void]>([
    ['different pre', (_, check) => { check.id = 'DI00123456788'; }],
    ['invalid primary pre', full => { full.id = ''; }],
    ['different plate', (_, check) => { check.plate = 'XYZ2D34'; }],
    ['different driver', (_, check) => { check.driver = 'OUTRO MOTORISTA'; }],
    ['conflicting known NF', (_, check) => { check.documents[1]!.nf = '999-1'; }],
    ['conflicting known volumes', (_, check) => { check.documents[1]!.volumes = '4'; check.totalVolumes = 7; }],
    ['conflicting laboratory', (_, check) => { check.documents[1]!.client = 'OUTRO LAB'; }],
    ['primary header count conflict', full => { full.expectedRows = 1; }],
    ['incomplete secondary table', (_, check) => { check.expectedRows = 3; }],
    ['absent secondary count', (_, check) => { check.expectedRows = 0; }],
    ['primary volume total conflict', full => { full.totalVolumes = 4; }],
    ['secondary sum conflict', (_, check) => { check.totalVolumes = 6; }],
    ['absent secondary volume total', (_, check) => { check.totalVolumes = 0; }],
    ['duplicate secondary CTC', (_, check) => { check.documents.push({ ...check.documents[0]! }); check.expectedRows = 3; check.totalVolumes = 8; }],
    ['duplicate primary CTC', full => { full.documents.push({ ...full.documents[0]! }); }],
    ['primary CTC absent from second table', full => { full.documents[0]!.ctc = '0000000999'; }],
    ['invalid primary CTC', full => { full.documents[0]!.ctc = ''; }],
    ['invalid secondary CTC', (_, check) => { check.documents[0]!.ctc = '999'; }],
    ['missing extra NF', (_, check) => { check.documents[0]!.nf = ''; }],
    ['missing extra volumes', (_, check) => { check.documents[0]!.volumes = ''; }],
    ['missing extra laboratory', (_, check) => { delete check.documents[0]!.client; }],
    ['missing extra recipient', (_, check) => { check.documents[0]!.recipient = '?'; }],
    ['DACTE without a shared pre identity', (full, check) => { full.kind = 'dacte'; check.kind = 'dacte'; }],
  ])('does not add a secondary row with %s', (_, change) => {
    const full = incomplete(); const check = completeCheck(); change(full, check);
    const count = full.documents.length;
    const result = meta(reconcilePhotoRead(full, check));
    expect(result.documents).toHaveLength(count);
    expect(result.verification.status).toBe('review');
    expect(result.documents.some(row => row.review?.some(message => message.includes('Linha recuperada')))).toBe(false);
  });
});
