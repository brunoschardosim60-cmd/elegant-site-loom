import { z } from 'zod';
import { normalizeIssueDate } from './manifest-date';

const activitySchema = z.object({ id: z.number(), title: z.string(), description: z.string(), time: z.string(), warning: z.boolean().optional() });
const documentSchema = z.object({ id: z.string(), ctc: z.string().regex(/^\d{10}$/), nf: z.string(), client: z.string().optional(), recipient: z.string().optional(), volumes: z.number().int().positive(), received: z.boolean(), receivedAt: z.string().optional() });
export const conferenceStateSchema = z.object({
  manifests: z.array(z.object({ id: z.string(), driver: z.string(), plate: z.string(), date: z.string(), issueDate: z.string().refine(value => normalizeIssueDate(value) === value, 'Data de emissão inválida').optional(), documents: z.array(documentSchema), finishedAt: z.string().optional() })),
  activity: z.array(activitySchema), issues: z.array(activitySchema),
});
export type ConferenceState = z.infer<typeof conferenceStateSchema>;
export const emptyConference: ConferenceState = { manifests: [], activity: [], issues: [] };
