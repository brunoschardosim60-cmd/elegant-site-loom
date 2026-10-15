import { createFileRoute, notFound } from '@tanstack/react-router';
import { ConferenceWorkspace } from '@/components/conference-workspace';

// Local-only visual preview with fictitious data; never available in production builds.
const now = Date.now();
const day = (n: number) => new Date(now - n * 86400000).toISOString();
const doc = (id: string, ctc: string, nf: string, volumes: number, received: boolean) => ({ id, ctc, nf, volumes, received, client: 'REMETENTE EXEMPLO', recipient: 'DESTINO EXEMPLO' });
const state = { activity: [], issues: [], manifests: [
  { id: 'DI0000000001', driver: 'MOTORISTA EXEMPLO A', plate: 'AAA1A11', date: day(3), issueDate: day(3).slice(0, 10), documents: [doc('a1', '0000000101', '1001-1', 3, true), doc('a2', '0000000102', '1002-1', 5, false), doc('a3', '0000000103', '1003-1', 2, false)] },
  { id: 'DI0000000002', driver: 'MOTORISTA EXEMPLO A', plate: 'AAA1A11', date: day(1), issueDate: day(1).slice(0, 10), documents: [doc('b1', '0000000201', '2001-1', 1, false)] },
  { id: 'DI0000000003', driver: 'MOTORISTA EXEMPLO B', plate: 'BBB2B22', date: day(0), issueDate: day(0).slice(0, 10), documents: [doc('c1', '0000000301', '3001-1', 4, true), doc('c2', '0000000302', '3002-1', 6, false)] },
] };

export const Route = createFileRoute('/layout-preview')({
  beforeLoad: () => { if (!import.meta.env.DEV) throw notFound(); },
  head: () => ({ meta: [{ title: 'Prévia de layout · confere.' }, { name: 'robots', content: 'noindex' }] }),
  component: () => <ConferenceWorkspace initialState={state} />,
});
