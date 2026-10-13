// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { emptyConference, type ConferenceState } from '@/lib/conference-state';
let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function as(n: number, role = 'authenticated') { await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid(n)}',false)`); }
async function call<T = any>(name: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ result: T }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0]!.result;
}
const make = (id = 'DI00123456789', ctc = '0000000001') => ({ id, driver: 'Motorista Teste', plate: 'ABC1234', date: '2026-10-13T03:00:00Z', documents: [{ id: `${id}-${ctc}`, ctc, nf: '123-1', volumes: 2, received: false }] });
const save = (base: ConferenceState, next: ConferenceState) => call<{ revision: number; data: ConferenceState }>('save_team_conference', [base, next]);
let teamId: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (let i = 1; i <= 5; i++) await db.query('insert into auth.users values($1,$2,$3)', [uid(i), `person${i}@example.com`, i === 5 ? null : '2026-10-13']);
  await db.exec(await readFile('supabase/migrations/20261011040000_conference.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261013040000_teams.sql', 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });
it('preserves the owner records and shares only with invited confirmed accounts, up to three', async () => {
  await as(1); await call('save_conference', [0, { ...emptyConference, manifests: [make()] }]);
  const owner = await call('get_conference_team'); teamId = owner.teamId;
  expect(owner.data.manifests).toHaveLength(1); expect(owner.owner).toBe(true);
  await call('invite_conference_member', ['person2@example.com']); await call('invite_conference_member', ['person3@example.com']);
  await expect(call('invite_conference_member', ['person4@example.com'])).rejects.toThrow('Equipe completa');
  await as(2); const personal = { ...emptyConference, manifests: [make('DI00123456999', '0000000999')] };
  await call('save_conference', [0, personal]);
  const invited = await call('get_conference_team'); expect(invited.teamId).not.toBe(teamId); expect(invited.invitation.ownerEmail).toBe('person1@example.com'); expect(invited.data).toEqual(personal);
  const member = await call('get_conference_team', [true]); expect(member.teamId).toBe(teamId); expect(member.owner).toBe(false); expect(member.data).toEqual(owner.data);
  expect((await db.query<{ data: unknown }>('select data from public.conference_states where user_id=$1', [uid(2)])).rows[0]!.data).toEqual(personal);
  await expect(call('invite_conference_member', ['person4@example.com'])).rejects.toThrow('Somente');
  await as(3); expect((await call('get_conference_team', [true])).teamId).toBe(teamId);
  await as(4); expect((await call('get_conference_team')).teamId).not.toBe(teamId);
  expect((await call('get_conference_team')).data.manifests).toEqual([]);
  await as(5); await expect(call('get_conference_team')).rejects.toThrow('Confirme');
});
it('merges simultaneous receipt of different CTCs and finalizes exactly once with authenticated audit', async () => {
  await as(1); const initial = (await call('get_conference_team')).data as ConferenceState;
  const two = structuredClone(initial); two.manifests[0]!.documents.push({ ...make(undefined, '0000000002').documents[0]! });
  const base = (await save(initial, two)).data;
  const a = structuredClone(base), b = structuredClone(base);
  a.manifests[0]!.documents[0]!.received = true; a.manifests[0]!.documents[0]!.receivedAt = '1900-01-01';
  b.manifests[0]!.documents[1]!.received = true;
  await as(2); await save(base, a);
  await as(3); const final = await save(base, b);
  expect(final.data.manifests[0]!.documents.every(d => d.received)).toBe(true); expect(final.data.manifests[0]!.finishedAt).toBeTruthy();
  expect(final.data.manifests[0]!.documents[0]!.receivedAt).not.toBe('1900-01-01');
  const history = await call<any[]>('get_conference_audit');
  expect(history.filter(e => e.action === 'pre_finished')).toHaveLength(1);
  expect(history.filter(e => e.action === 'ctc_received').map(e => e.actor_email).sort()).toEqual(['person2@example.com', 'person3@example.com']);
  await as(2); const repeat = await save(base, a);
  expect(repeat.data.manifests[0]!.documents.every(d => d.received)).toBe(true);
  expect((await call<any[]>('get_conference_audit')).filter(e => e.action === 'ctc_received')).toHaveLength(2);
});
it('combines two new different pres, rejects duplicate CTCs and rejects competing edits/deletions atomically', async () => {
  await as(1); let base = (await call('get_conference_team')).data as ConferenceState;
  const a = structuredClone(base), b = structuredClone(base);
  a.manifests.push(make('DI00123456790', '0000000003')); b.manifests.push(make('DI00123456791', '0000000004'));
  await as(2); await save(base, a); await as(3); const combined = await save(base, b); expect(combined.data.manifests).toHaveLength(3);
  const duplicate = structuredClone(combined.data); duplicate.manifests.push(make('DI00123456792', '0000000003'));
  await expect(save(combined.data, duplicate)).rejects.toThrow('CONFERENCE_DUPLICATE');
  expect((await call('get_conference_team')).data).toEqual(combined.data);
  base = combined.data; const left = structuredClone(base), right = structuredClone(base), removed = structuredClone(base);
  left.manifests[0]!.documents[0]!.nf = '100-1'; right.manifests[0]!.documents[0]!.nf = '200-1'; removed.manifests.shift();
  await as(1); await save(base, left); await as(2);
  await expect(save(base, right)).rejects.toThrow('CONFERENCE_CONFLICT');
  await expect(save(base, removed)).rejects.toThrow('CONFERENCE_CONFLICT');
  expect((await call('get_conference_team')).data.manifests[0].documents[0].nf).toBe('100-1');
});
it('cannot use another team identity, forge audit or use the legacy write endpoint for a shared team', async () => {
  await as(4); expect(await call('get_conference_audit')).toEqual([]);
  const outsider = await call('get_conference_team'); expect(outsider.teamId).not.toBe(teamId);
  await expect(db.exec('select * from public.conference_audit')).rejects.toThrow('permission denied');
  await expect(db.exec(`insert into public.conference_audit(team_id,actor_email,manifest_id,action) values('${teamId}','forged','fake','pre_added')`)).rejects.toThrow('permission denied');
  await expect(db.exec(`update public.conference_states set data='{}' where user_id='${uid(1)}'`)).rejects.toThrow('permission denied');
  await as(1); await expect(call('save_conference', [1, emptyConference])).rejects.toThrow('CONFERENCE_TEAM_RELOAD');
  await as(1, 'anon'); await expect(call('get_conference_team')).rejects.toThrow('permission denied');
});
it('rejects malformed data without changing records or audit and supports pending invite cancellation', async () => {
  await as(1); const base = (await call('get_conference_team')).data as ConferenceState, history = await call('get_conference_audit');
  for (const field of ['nf', 'ctc', 'received']) {
    const invalid = structuredClone(base) as any; delete invalid.manifests[0].documents[0][field];
    await expect(save(base, invalid)).rejects.toThrow('CONFERENCE_INVALID');
  }
  expect((await call('get_conference_team')).data).toEqual(base); expect(await call('get_conference_audit')).toEqual(history);
  await as(4); await expect(call('invite_conference_member', ['person1@example.com'])).rejects.toThrow('outra equipe');
  await call('invite_conference_member', ['person5@example.com']); await call('invite_conference_member', ['new@example.com']);
  await expect(call('invite_conference_member', ['fourth@example.com'])).rejects.toThrow('Equipe completa');
  await call('cancel_conference_invite', ['new@example.com']);
  expect((await call('get_conference_team')).members).toHaveLength(2);
  await as(5); await expect(call('get_conference_team', [true])).rejects.toThrow('Confirme');
});
