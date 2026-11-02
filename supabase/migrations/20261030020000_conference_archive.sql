-- Keep the live team row small. Each team's data lives in one JSON row capped
-- at 5 MB; finished manifests are moved here after a waiting period. The live
-- save RPC is not changed: a trigger extends its duplicate rules to the archive,
-- and archived records are reachable only through the RPCs below.
begin;

create table public.conference_archive (
  owner_id uuid not null references auth.users(id) on delete cascade,
  manifest_id text not null,
  issue_date date,
  finished_at timestamptz not null,
  archived_at timestamptz not null default now(),
  ctcs text[] not null,
  photo_hashes text[] not null default '{}',
  data jsonb not null,
  primary key (owner_id, manifest_id)
);
create index conference_archive_ctcs on public.conference_archive using gin (ctcs);
create index conference_archive_photo_hashes on public.conference_archive using gin (photo_hashes);
alter table public.conference_archive enable row level security;
revoke all on public.conference_archive from public, anon, authenticated;

-- Server-assigned finishedAt only; a reopened manifest has none.
create function public.conference_finished_at(manifest jsonb) returns timestamptz
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(manifest->'finishedAt')='string'
    and manifest->>'finishedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    then (manifest->>'finishedAt')::timestamptz end
$$;
revoke all on function public.conference_finished_at(jsonb) from public, anon, authenticated;

-- Team owner of the caller, with the same membership rule as the save RPC.
create function public.conference_caller_owner() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare oid uuid;
begin
  perform public.conference_require_confirmed_user();
  select t.owner_id into oid from public.conference_teams t
    join public.conference_members mem on mem.team_id=t.id where mem.user_id=auth.uid();
  if oid is null then raise exception 'Equipe não autorizada'; end if;
  return oid;
end $$;
revoke all on function public.conference_caller_owner() from public, anon, authenticated;

-- Moves manifests finished at least min_days ago out of the live row.
-- Idempotent: returns 0 without locking when nothing qualifies.
create function public.archive_conference_manifests(min_days integer default 30) returns integer
language plpgsql security definer set search_path='' as $$
declare tid uuid; oid uuid; cur jsonb; cutoff timestamptz; moved integer;
begin
  if min_days is null or min_days < 7 or min_days > 365 then raise exception 'CONFERENCE_INVALID'; end if;
  oid := public.conference_caller_owner();
  cutoff := now() - make_interval(days => min_days);
  if not exists(select 1 from public.conference_states s
      cross join lateral jsonb_array_elements(s.data->'manifests') m
      where s.user_id=oid and public.conference_finished_at(m.value) <= cutoff) then
    return 0;
  end if;
  -- Same lock order as save_team_conference: team row, then the state row.
  select t.id into tid from public.conference_teams t where t.owner_id=oid for update;
  select data into cur from public.conference_states where user_id=oid for update;
  insert into public.conference_archive as a
    (owner_id, manifest_id, issue_date, finished_at, ctcs, photo_hashes, data)
  select oid, m->>'id',
    case when m->>'issueDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (m->>'issueDate')::date end,
    public.conference_finished_at(m),
    coalesce((select array_agg(distinct d->>'ctc') from jsonb_array_elements(m->'documents') d), '{}'),
    coalesce((select array_agg(distinct lower(h)) from jsonb_array_elements_text(coalesce(m->'sourcePhotoHashes','[]')) h), '{}'),
    m
  from jsonb_array_elements(cur->'manifests') m
  where public.conference_finished_at(m) <= cutoff
  on conflict (owner_id, manifest_id) do update set
    issue_date=excluded.issue_date, finished_at=excluded.finished_at, archived_at=now(),
    ctcs=excluded.ctcs, photo_hashes=excluded.photo_hashes, data=excluded.data;
  get diagnostics moved = row_count;
  update public.conference_states set
    data=jsonb_set(cur, '{manifests}', coalesce((
      select jsonb_agg(m order by ord) from jsonb_array_elements(cur->'manifests') with ordinality x(m, ord)
      where public.conference_finished_at(m) is null or public.conference_finished_at(m) > cutoff), '[]')),
    revision=revision+1, updated_at=now()
  where user_id=oid;
  return moved;
end $$;
revoke all on function public.archive_conference_manifests(integer) from public, anon;
grant execute on function public.archive_conference_manifests(integer) to authenticated;

-- Archived manifests matching any of the given IDs, CTCs or photo hashes.
create function public.find_archived_conference_manifests(
  manifest_ids text[] default '{}', ctc_numbers text[] default '{}', hashes text[] default '{}'
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare oid uuid; found jsonb;
begin
  if coalesce(cardinality(manifest_ids),0) > 500 or coalesce(cardinality(ctc_numbers),0) > 5000
    or coalesce(cardinality(hashes),0) > 500 then raise exception 'CONFERENCE_INVALID'; end if;
  oid := public.conference_caller_owner();
  select coalesce(jsonb_agg(jsonb_build_object('manifest', a.data, 'archivedAt', a.archived_at)
      order by a.finished_at desc), '[]')
    into found
  from (select data, archived_at, finished_at from public.conference_archive
    where owner_id=oid and (manifest_id = any(coalesce(manifest_ids,'{}'))
      or ctcs && coalesce(ctc_numbers,'{}')
      or photo_hashes && (select coalesce(array_agg(lower(h)),'{}') from unnest(coalesce(hashes,'{}')) h))
    order by finished_at desc limit 200) a;
  return found;
end $$;
revoke all on function public.find_archived_conference_manifests(text[],text[],text[]) from public, anon;
grant execute on function public.find_archived_conference_manifests(text[],text[],text[]) to authenticated;

-- Extends the live duplicate rules to the archive for anything newly added:
-- a manifest ID, a photo fingerprint, or a CTC on the same (or an unknown)
-- issue date. A CTC on a different dated route stays allowed, as in
-- conference_has_ctc_conflicts.
create function public.conference_archive_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb := case when tg_op='UPDATE' then coalesce(old.data->'manifests','[]') else '[]' end;
begin
  if not exists(select 1 from public.conference_archive where owner_id=new.user_id) then return new; end if;
  if exists(
    with added as (
      select nm from jsonb_array_elements(new.data->'manifests') nm
      where not exists(select 1 from jsonb_array_elements(previous) om where om->>'id'=nm->>'id'))
    select 1 from added join public.conference_archive a
      on a.owner_id=new.user_id and a.manifest_id=added.nm->>'id'
  ) then raise exception 'CONFERENCE_DUPLICATE'; end if;
  if exists(
    with incoming as (
      select distinct lower(h) h from jsonb_array_elements(new.data->'manifests') nm
        cross join lateral jsonb_array_elements_text(coalesce(nm->'sourcePhotoHashes','[]')) h),
    existing as (
      select distinct lower(h) h from jsonb_array_elements(previous) om
        cross join lateral jsonb_array_elements_text(coalesce(om->'sourcePhotoHashes','[]')) h)
    select 1 from incoming i
    where not exists(select 1 from existing e where e.h=i.h)
      and exists(select 1 from public.conference_archive a where a.owner_id=new.user_id and i.h = any(a.photo_hashes))
  ) then raise exception 'CONFERENCE_DUPLICATE'; end if;
  if exists(
    with incoming as (
      select nm->>'id' mid, nm->>'issueDate' idate, nd->>'ctc' ctc
      from jsonb_array_elements(new.data->'manifests') nm
        cross join lateral jsonb_array_elements(nm->'documents') nd),
    existing as (
      select om->>'id' mid, od->>'ctc' ctc from jsonb_array_elements(previous) om
        cross join lateral jsonb_array_elements(om->'documents') od),
    added as (
      select i.* from incoming i
      where not exists(select 1 from existing e where e.mid=i.mid and e.ctc=i.ctc))
    select 1 from added
      join public.conference_archive a on a.owner_id=new.user_id and added.ctc = any(a.ctcs)
    where a.issue_date is null
      or coalesce(added.idate,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or a.issue_date = added.idate::date
  ) then raise exception 'CONFERENCE_DUPLICATE'; end if;
  return new;
end $$;
revoke all on function public.conference_archive_guard() from public, anon, authenticated;

create trigger conference_archive_guard
  before insert or update of data on public.conference_states
  for each row execute function public.conference_archive_guard();

-- A device that has not yet refreshed still sends archived manifests in its
-- base and next snapshots. When the device did not change such a manifest,
-- drop it from both before the unchanged save RPC runs, so archiving reads as
-- the server-side removal it is instead of a conflict. An edited archived
-- manifest is left in place and is still rejected by the save RPC.
create function public.save_team_conference_v2(base_data jsonb, next_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare oid uuid; settled text[];
begin
  if jsonb_typeof(base_data->'manifests')='array' and jsonb_typeof(next_data->'manifests')='array' then
    oid := public.conference_caller_owner();
    select coalesce(array_agg(a.manifest_id), '{}') into settled
    from public.conference_archive a
    join jsonb_array_elements(base_data->'manifests') bm on bm->>'id'=a.manifest_id
    where a.owner_id=oid
      and not exists(select 1 from jsonb_array_elements(next_data->'manifests') nm
        where nm->>'id'=a.manifest_id and nm is distinct from bm);
    if cardinality(settled) > 0 then
      base_data := jsonb_set(base_data, '{manifests}', coalesce((
        select jsonb_agg(m order by ord) from jsonb_array_elements(base_data->'manifests') with ordinality x(m, ord)
        where not (m->>'id' = any(settled))), '[]'));
      next_data := jsonb_set(next_data, '{manifests}', coalesce((
        select jsonb_agg(m order by ord) from jsonb_array_elements(next_data->'manifests') with ordinality x(m, ord)
        where not (m->>'id' = any(settled))), '[]'));
    end if;
  end if;
  return public.save_team_conference(base_data, next_data);
end $$;
revoke all on function public.save_team_conference_v2(jsonb,jsonb) from public, anon;
grant execute on function public.save_team_conference_v2(jsonb,jsonb) to authenticated;

commit;
