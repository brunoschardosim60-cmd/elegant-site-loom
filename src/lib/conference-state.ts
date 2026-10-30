import { manifestIdPattern } from "./manifest-id";
import { z } from "zod";
import { normalizeIssueDate, normalizeIssueTime } from "./manifest-date";
import { normalizeReportGeneratedAt } from "./nf-occurrence-date";

const activitySchema = z.object({
  id: z.union([z.number(), z.guid()]),
  title: z.string(),
  description: z.string(),
  time: z.string(),
  at: z.string().datetime().optional(),
  warning: z.boolean().optional(),
});
const documentSchema = z.object({
  id: z.string(),
  ctc: z.string().regex(/^\d{10}$/),
  nf: z.string(),
  client: z.string().optional(),
  recipient: z.string().optional(),
  volumes: z.number().int().positive(),
  received: z.boolean(),
  receivedAt: z.string().optional(),
  receivedBy: z.guid().optional(),
  receivedByEmail: z.string().email().optional(),
  receiptChecks: z
    .array(
      z.object({
        id: z.guid(),
        received: z.boolean(),
        receivedAt: z.string().optional(),
        email: z.string().email().optional(),
        acceptedFrom: z.guid().optional(),
        sourceReceivedAt: z.string().optional(),
        documentVersion: z.string().optional(),
        legacy: z.boolean().optional(),
      }),
    )
    .max(1000)
    .optional(),
  nfOccurrences: z
    .array(
      z
        .object({
          nf: z.string().regex(/^\d{1,9}-\d{1,3}$/),
          code: z.string().max(32),
          description: z.string().max(1000),
          occurredOn: z
            .string()
            .refine((value) => normalizeIssueDate(value) === value)
            .optional(),
          reportGeneratedAt: z
            .string()
            .refine((value) => normalizeReportGeneratedAt(value) === value)
            .optional(),
        })
        .refine((value) => !!(value.code || value.description)),
    )
    .max(3000)
    .optional(),
  deliveryDates: z
    .array(z.string().refine((value) => normalizeIssueDate(value) === value))
    .max(300)
    .optional(),
});
export const manifestSchema = z.object({
  id: z.string(),
  createdBy: z.guid().optional(),
  demandUserIds: z.array(z.guid()).max(1000).optional(),
  createdByEmail: z.string().email().optional(),
  updatedBy: z.guid().optional(),
  updatedByEmail: z.string().email().optional(),
  updatedAt: z.string().optional(),
  driver: z.string(),
  plate: z.string(),
  date: z.string(),
  issueDate: z
    .string()
    .refine((value) => normalizeIssueDate(value) === value, "Data de emissão inválida")
    .optional(),
  issueTime: z
    .string()
    .refine((value) => normalizeIssueTime(value) === value)
    .optional(),
  previousIds: z.array(z.string().regex(manifestIdPattern)).optional(),
  expectedRows: z.number().int().min(0).max(300).optional(),
  totalVolumes: z.number().int().min(0).max(1000000).optional(),
  totalsReviewed: z.boolean().optional(),
  sourcePhotoHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).optional(),
  documents: z.array(documentSchema),
  finishedAt: z.string().optional(),
});
export const conferenceStateSchema = z.object({
  manifests: z.array(manifestSchema),
  activity: z.array(activitySchema),
  issues: z.array(activitySchema),
});
export type ConferenceState = z.infer<typeof conferenceStateSchema>;
export const emptyConference: ConferenceState = { manifests: [], activity: [], issues: [] };
