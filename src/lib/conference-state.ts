import { manifestIdPattern } from "./manifest-id";
import { z } from "zod";
import { normalizeIssueDate } from "./manifest-date";

const activitySchema = z.object({
  id: z.union([z.number(), z.string().uuid()]),
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
});
export const conferenceStateSchema = z.object({
  manifests: z.array(
    z.object({
      id: z.string(),
      driver: z.string(),
      plate: z.string(),
      date: z.string(),
      issueDate: z
        .string()
        .refine((value) => normalizeIssueDate(value) === value, "Data de emissão inválida")
        .optional(),
      previousIds: z.array(z.string().regex(manifestIdPattern)).optional(),
      expectedRows: z.number().int().min(0).max(300).optional(),
      totalVolumes: z.number().int().min(0).max(1000000).optional(),
      totalsReviewed: z.boolean().optional(),
      sourcePhotoHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).optional(),
      documents: z.array(documentSchema),
      finishedAt: z.string().optional(),
    }),
  ),
  activity: z.array(activitySchema),
  issues: z.array(activitySchema),
});
export type ConferenceState = z.infer<typeof conferenceStateSchema>;
export const emptyConference: ConferenceState = { manifests: [], activity: [], issues: [] };
