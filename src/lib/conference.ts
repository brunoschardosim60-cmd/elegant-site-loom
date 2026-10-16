export type NfOccurrence = {
  nf: string;
  code: string;
  description: string;
  occurredOn?: string | undefined;
  reportGeneratedAt?: string | undefined;
};
export type DocumentItem = {
  id: string;
  ctc: string;
  nf: string;
  client?: string | undefined;
  recipient?: string | undefined;
  volumes: number;
  received: boolean;
  receivedAt?: string | undefined;
  receivedBy?: string | undefined;
  receivedByEmail?: string | undefined;
  deliveryDates?: string[] | undefined;
  /** Last reported Luft occurrence for each literal NF-series, independent of receipt. */
  nfOccurrences?: NfOccurrence[] | undefined;
  /** Derived for display only; never persisted. */
  reroutedTo?: string | undefined;
};
export type Manifest = {
  id: string;
  /** Assigned by the authenticated server; edits and receipts keep the original creator. */
  createdBy?: string | undefined;
  createdByEmail?: string | undefined;
  updatedBy?: string | undefined;
  updatedByEmail?: string | undefined;
  updatedAt?: string | undefined;
  driver: string;
  plate: string;
  date: string;
  issueDate?: string | undefined;
  issueTime?: string | undefined;
  sourcePhotoHashes?: string[] | undefined;
  previousIds?: string[] | undefined;
  expectedRows?: number | undefined;
  totalVolumes?: number | undefined;
  totalsReviewed?: boolean | undefined;
  documents: DocumentItem[];
  finishedAt?: string | undefined;
  /** Derived for display only; never persisted. */
  routeResolved?: boolean | undefined;
};
export type Reading = { kind: "ctc"; number: string } | { kind: "nfe" } | { kind: "invalid" };

export function parseReading(value: string): Reading {
  const code = value.trim().replace(/\s/g, "");
  if (!/^\d+$/.test(code)) return { kind: "invalid" };
  if (code.length === 10) return { kind: "ctc", number: code };
  if (code.length === 44 && code.slice(20, 22) === "55") return { kind: "nfe" };
  return { kind: "invalid" };
}

/** A scan is accepted only when it directly contains a CTC or a recognized NF-e key. */
export function parseScan(value: string): Reading {
  return parseReading(value);
}

export function findMatches(manifests: Manifest[], reading: Extract<Reading, { kind: "ctc" }>) {
  return manifests.flatMap((manifest) =>
    manifest.documents
      .filter((doc) => doc.ctc === reading.number)
      .map((doc) => ({ manifest, doc })),
  );
}

export function setReceived(
  manifest: Manifest,
  id: string,
  received: boolean,
  now: string,
): Manifest {
  const documents = manifest.documents.map((doc) =>
    doc.id === id ? { ...doc, received, receivedAt: received ? now : undefined } : doc,
  );
  return {
    ...manifest,
    documents,
    finishedAt: documents.every((doc) => doc.received) ? now : undefined,
  };
}

export type PreDraft = { id: string; plate: string; ctcs: string[] };

/** Fixes the digit confusions OCR commonly makes inside numeric fields. */
const toDigits = (v: string) =>
  v
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/\D/g, "");

/** Extract labelled CTC identifiers without converting fiscal keys. */
export function parsePreText(text: string): PreDraft {
  const upper = text.toUpperCase();
  const idMatch = upper.match(/\bD\s?[I1L|]\s?[-:.]?\s?([0-9OQIL|SB](?:\s*[0-9OQIL|SB]){7,11})\b/);
  // Some scans omit the printed DI prefix or split the prefix and number into separate OCR lines.
  // Only recover a bare number when it is immediately associated with a pre-manifest label.
  const labelledNumber = upper.match(
    /(?:PR[EÉ][- ]?MANIFESTO|N[º°O.]?\s*(?:DO?\s*)?PR[EÉ])[^\d]{0,24}([0-9OQIL|SB](?:[\s.-]*[0-9OQIL|SB]){7,11})/,
  );
  const idDigits = idMatch?.[1]
    ? toDigits(idMatch[1])
    : labelledNumber?.[1]
      ? toDigits(labelledNumber[1])
      : "";
  const id = idDigits.length >= 8 && idDigits.length <= 12 ? `DI${idDigits}` : "";
  const plateMatch = upper.match(
    /\b([A-Z]{3})[\s-]?([0-9OIL])\s?([A-Z0-9])\s?([0-9OIL])\s?([0-9OIL])\b/,
  );
  const plate = plateMatch
    ? `${plateMatch[1]}${toDigits(plateMatch[2]!)}${plateMatch[3]}${toDigits(plateMatch[4]!)}${toDigits(plateMatch[5]!)}`
    : "";
  const ctcs = new Set<string>();
  for (const m of upper.matchAll(
    /\bC\s?T\s?[-–.]?\s?C\b\.?\s*(?:N[º°O.]*)?\s*[:#.-]?\s*([0-9OIL]{10})\b/g,
  )) {
    const n = toDigits(m[1]!);
    if (n.length === 10) ctcs.add(n);
  }
  return { id, plate, ctcs: [...ctcs] };
}
