import { expect, it, vi } from 'vitest';
import { mergeConference, TeamSync, type ConferenceTeam, type TeamSyncView } from '@/lib/conference-team';
import type { ConferenceState } from '@/lib/conference-state';
const state = (): ConferenceState => ({ manifests: [{ id: 'DI00123456789', driver: 'Teste', plate: 'ABC1234', date: '2026-10-13', documents: [1, 2].map(n => ({ id: String(n), ctc: String(n).padStart(10, '0'), nf: '1-1', volumes: 1, received: false })) }], activity: [], issues: [] });
const team = (data = state(), revision = 1): ConferenceTeam => ({ teamId: '00000000-0000-4000-8000-000000000001', name: 'Equipe', owner: true, members: [], data, revision });
const receive = (s: ConferenceState, index: number) => { const n = structuredClone(s); n.manifests[0]!.documents[index]!.received = true; n.manifests[0]!.documents[index]!.receivedAt = '2026-10-13T03:00:00Z'; return n; };
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; }
it('merges different received CTCs and resolves a repeated scan without resetting the other', () => {
  const base = state(), a = receive(base, 0), b = receive(base, 1);
  const both = mergeConference(base, a, b); expect(both.manifests[0]!.documents.every(d => d.received)).toBe(true); expect(both.manifests[0]!.finishedAt).toBeTruthy();
  expect(mergeConference(base, a, both).manifests).toEqual(both.manifests);
});
it('rejects divergent edits and a deletion conflicting with a remote edit', () => {
  const base = state(), a = structuredClone(base), b = structuredClone(base);
  a.manifests[0]!.documents[0]!.nf = '100'; b.manifests[0]!.documents[0]!.nf = '200';
  expect(() => mergeConference(base, a, b)).toThrow('CONFERENCE_CONFLICT');
  a.manifests = []; expect(() => mergeConference(base, a, b)).toThrow('CONFERENCE_CONFLICT');
});
it('rebases a second local action during save and serializes only the remaining change', async () => {
  const gate = deferred(), publish = vi.fn<(v: TeamSyncView) => void>();
  const rpc = vi.fn().mockReturnValueOnce(gate.promise).mockImplementation(async (_name, args) => ({ data: { revision: 3, data: args.next_data }, error: null }));
  const base = state(), sync = new TeamSync(team(base), rpc, publish);
  const first = receive(base, 0); sync.change(first); const second = receive(first, 1); sync.change(second);
  expect(rpc).toHaveBeenCalledOnce(); const remote = structuredClone(first); remote.manifests[0]!.plate = 'DEF5678';
  gate.resolve({ data: { revision: 2, data: remote }, error: null });
  await vi.waitFor(() => expect(sync.pending()).toBe(false));
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[1]![1].base_data).toEqual(remote);
  const final = publish.mock.lastCall![0]; expect(final.state.manifests[0]!.plate).toBe('DEF5678'); expect(final.state.manifests[0]!.documents.every(d => d.received)).toBe(true);
});
it('preserves an action typed during a refresh and then saves it against the updated remote base', async () => {
  const gate = deferred(), base = state(), publish = vi.fn();
  const rpc = vi.fn().mockReturnValueOnce(gate.promise).mockImplementation(async (_name, args) => ({ data: { revision: 3, data: args.next_data }, error: null }));
  const sync = new TeamSync(team(base), rpc, publish); const refreshing = sync.refresh(true); sync.change(receive(base, 0));
  gate.resolve({ data: team(receive(base, 1), 2), error: null }); await refreshing;
  await vi.waitFor(() => expect(sync.pending()).toBe(false)); expect(publish.mock.lastCall![0].state.manifests[0].documents.every((d: any) => d.received)).toBe(true);
});
it('retains edits for retry and never resubmits a duplicate automatically', async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ error: { message: 'network' } }).mockImplementation(async (_name, args) => ({ data: { revision: 2, data: args.next_data }, error: null }));
  const publish = vi.fn(), sync = new TeamSync(team(), rpc, publish); sync.change(receive(state(), 0));
  await vi.waitFor(() => expect(publish.mock.lastCall![0].error).toContain('Não foi possível'));
  expect(sync.pending()).toBe(true); sync.retry(); await vi.waitFor(() => expect(sync.pending()).toBe(false));
  rpc.mockResolvedValue({ error: { message: 'CONFERENCE_DUPLICATE' } }); sync.change(receive(publish.mock.lastCall![0].state, 1));
  await vi.waitFor(() => expect(publish.mock.lastCall![0].conflict).toBe(true)); const count = rpc.mock.calls.length; await sync.refresh(); expect(rpc).toHaveBeenCalledTimes(count);
});
it('ignores late results after unmount and rejects an unexpected workspace switch', async () => {
  const gate = deferred(), rpc = vi.fn().mockReturnValue(gate.promise), publish = vi.fn(); const sync = new TeamSync(team(), rpc, publish);
  const pending = sync.refresh(true); sync.stop(); gate.resolve({ data: team(state(), 2), error: null }); await pending; expect(publish).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: { ...team(), teamId: '00000000-0000-4000-8000-000000000002' }, error: null }); const other = new TeamSync(team(), rpc, publish); await other.refresh(true); expect(publish.mock.lastCall![0].conflict).toBe(true);
});
it('polls only the revision when nothing changed and never downloads or saves the whole state', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { teamId: team().teamId, revision: 1 }, error: null }), publish = vi.fn();
  const sync = new TeamSync(team(), rpc, publish); await sync.refresh();
  expect(rpc).toHaveBeenCalledExactlyOnceWith('get_conference_revision', {}); expect(sync.pending()).toBe(false);
});

it('classifies conflicting new records with the same ID as duplicates while accepting idempotent repeats', () => {
  const base = state(), a = structuredClone(base), b = structuredClone(base);
  const added = { ...base.manifests[0]!, id: 'DI00123456999' }; a.manifests.push(added); b.manifests.push({ ...added, driver: 'Outro' });
  expect(() => mergeConference(base, a, b)).toThrow('CONFERENCE_DUPLICATE'); expect(mergeConference(base, a, a).manifests).toEqual(a.manifests);
});

it('recovers a transient read failure after backoff even when the revision did not change', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
  try {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { message: 'network' } }).mockResolvedValue({ data: { teamId: team().teamId, revision: 1 }, error: null });
    const publish = vi.fn(), sync = new TeamSync(team(), rpc, publish);
    await sync.refresh(); expect(publish.mock.lastCall![0].status).toBe('Sincronização interrompida');
    await sync.refresh(); expect(rpc).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(105000); await sync.refresh();
    expect(publish.mock.lastCall![0]).toMatchObject({ error: '', pending: false, status: 'Todos os dados salvos' });
    expect(rpc).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); }
});
it('merges remote receipts before saving an edit made during an interrupted refresh', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
  try {
    const base=state(), remote=receive(base,1), publish=vi.fn();
    const rpc=vi.fn().mockResolvedValueOnce({error:{message:'network'}}).mockResolvedValueOnce({data:{teamId:team().teamId,revision:2},error:null}).mockResolvedValueOnce({data:team(remote,2),error:null}).mockImplementation(async(_name,args)=>({data:{revision:3,data:args.next_data},error:null}));
    const sync=new TeamSync(team(base),rpc,publish);await sync.refresh();sync.change(receive(base,0));
    expect(sync.pending()).toBe(true);expect(rpc).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(105000);await sync.refresh();await sync.flush();
    expect(publish.mock.lastCall![0].state.manifests[0].documents.every((d:any)=>d.received)).toBe(true);
    expect(rpc.mock.calls[3]![1].base_data).toEqual(remote);
    expect(sync.pending()).toBe(false);
  } finally { clock.mockRestore(); }
});
it('never auto-retries a failed save or a conflicting refresh', async () => {
  const rpc=vi.fn().mockResolvedValue({error:{message:'network'}}),publish=vi.fn(),sync=new TeamSync(team(),rpc,publish);
  sync.change(receive(state(),0));await vi.waitFor(()=>expect(publish.mock.lastCall![0].error).toBeTruthy());await sync.refresh(true);
  expect(rpc).toHaveBeenCalledTimes(1);expect(sync.pending()).toBe(true);
  rpc.mockResolvedValue({data:{...team(),teamId:'00000000-0000-4000-8000-000000000002'},error:null});
  const other=new TeamSync(team(),rpc,publish);await other.refresh(true);const count=rpc.mock.calls.length;await other.refresh(true);
  expect(rpc).toHaveBeenCalledTimes(count);expect(publish.mock.lastCall![0].conflict).toBe(true);
});
