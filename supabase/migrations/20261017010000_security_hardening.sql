-- No record/membership backfill. Tighten existing authenticated entry points.
begin;
create or replace function public.conference_require_confirmed_user()
returns uuid language plpgsql set search_path='' as $$
declare uid uuid=auth.uid();
begin
  if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Authentication required'; end if;
  return uid;
end $$;
revoke all on function public.conference_require_confirmed_user() from public,anon,authenticated;

-- Atomic per-account limits survive Vercel restarts and simultaneous instances.
create table if not exists public.conference_reader_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null,
  requests integer not null check(requests between 1 and 80)
);
alter table public.conference_reader_limits enable row level security;
revoke all on public.conference_reader_limits from public,anon,authenticated;
create or replace function public.consume_conference_reader_quota()
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid=public.conference_require_confirmed_user(); stamp timestamptz=clock_timestamp(); accepted uuid;
begin
  if public.conference_reader_owner() is null then return false; end if;
  insert into public.conference_reader_limits as limits(user_id,window_started,requests) values(uid,stamp,1)
  on conflict(user_id) do update set
    window_started=case when limits.window_started<=stamp-interval '10 minutes' then stamp else limits.window_started end,
    requests=case when limits.window_started<=stamp-interval '10 minutes' then 1 else limits.requests+1 end
  where limits.window_started<=stamp-interval '10 minutes' or limits.requests<80
  returning user_id into accepted;
  return accepted is not null;
end $$;
revoke all on function public.consume_conference_reader_quota() from public,anon;
grant execute on function public.consume_conference_reader_quota() to authenticated;

-- Reject oversized payloads and unexpected nested fields before recursive merge.
create or replace function public.conference_validate_input(payload jsonb)
returns void language plpgsql set search_path='' as $$
declare m jsonb; d jsonb; event jsonb;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>=5000000
    or (payload-'manifests'-'activity'-'issues')<>'{}'
    or jsonb_typeof(payload->'manifests') is distinct from 'array'
    or jsonb_typeof(payload->'activity') is distinct from 'array'
    or jsonb_typeof(payload->'issues') is distinct from 'array' then raise exception 'CONFERENCE_INVALID'; end if;
  for m in select value from jsonb_array_elements(payload->'manifests') loop
    if jsonb_typeof(m) is distinct from 'object' or
      m-ARRAY['id','driver','plate','date','issueDate','issueTime','documents','createdBy','createdByEmail','updatedBy','updatedByEmail','updatedAt','previousIds','expectedRows','totalVolumes','totalsReviewed','sourcePhotoHashes','finishedAt']<>'{}'
      or jsonb_typeof(m->'documents') is distinct from 'array' then raise exception 'CONFERENCE_INVALID'; end if;
    -- Every non-array manifest field is scalar. This bounds recursive merge depth.
    if exists(select 1 from jsonb_each(m) where key not in ('documents','previousIds','sourcePhotoHashes') and jsonb_typeof(value) in ('object','array')) then raise exception 'CONFERENCE_INVALID'; end if;
    if exists(select 1 from jsonb_each(m) where key in ('previousIds','sourcePhotoHashes') and jsonb_typeof(value)<>'array') then raise exception 'CONFERENCE_INVALID'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(m->'previousIds','[]')||coalesce(m->'sourcePhotoHashes','[]')) where jsonb_typeof(value)<>'string') then raise exception 'CONFERENCE_INVALID'; end if;
    for d in select value from jsonb_array_elements(m->'documents') loop
      if jsonb_typeof(d) is distinct from 'object' or
        d-ARRAY['id','ctc','nf','client','recipient','volumes','received','receivedAt','receivedBy','receivedByEmail','nfOccurrences','deliveryDates']<>'{}'
        or exists(select 1 from jsonb_each(d) where key not in ('nfOccurrences','deliveryDates') and jsonb_typeof(value) in ('object','array')) then raise exception 'CONFERENCE_INVALID'; end if;
      if exists(select 1 from jsonb_each(d) where key in ('nfOccurrences','deliveryDates') and jsonb_typeof(value)<>'array') then raise exception 'CONFERENCE_INVALID'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(d->'deliveryDates','[]')) where jsonb_typeof(value)<>'string') then raise exception 'CONFERENCE_INVALID'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(d->'nfOccurrences','[]')) where jsonb_typeof(value)<>'object' or value-ARRAY['nf','code','description','occurredOn','reportGeneratedAt']<>'{}' or exists(select 1 from jsonb_each(value) where jsonb_typeof(value) in ('array','object'))) then raise exception 'CONFERENCE_INVALID'; end if;
    end loop;
  end loop;
  for event in select value from jsonb_array_elements(payload->'activity'||payload->'issues') loop
    if jsonb_typeof(event) is distinct from 'object' or event-ARRAY['id','title','description','time','at','warning']<>'{}'
      or exists(select 1 from jsonb_each(event) where jsonb_typeof(value) in ('object','array')) then raise exception 'CONFERENCE_INVALID'; end if;
  end loop;
end $$;
revoke all on function public.conference_validate_input(jsonb) from public,anon,authenticated;

do $migration$
declare definition text; signature text;
  marker text='perform 1 from public.conference_teams where id=tid for update;';
begin
  definition=pg_get_functiondef('public.get_conference_team(boolean)'::regprocedure);
  if position('Convite cancelado' in definition)=0 then
    if position(marker in definition)=0 then raise exception 'Unexpected invitation version'; end if;
    definition=replace(definition,marker,marker||chr(10)||$guard$
      -- Cancellation and acceptance lock the same team. Recheck AFTER waiting.
      if not exists(select 1 from public.conference_invites where team_id=tid and email=em) then raise exception 'Convite cancelado. Atualize a página.'; end if;
    $guard$);
    execute definition;
  end if;
  foreach signature in array ARRAY['public.get_conference_revision()','public.get_conference_audit(text,bigint)','public.invite_conference_member(text)','public.cancel_conference_invite(text)','public.save_conference(bigint,jsonb)'] loop
    definition=pg_get_functiondef(signature::regprocedure);
    if position('conference_require_confirmed_user' in definition)=0 then
      definition=regexp_replace(definition,'\mbegin\M','begin'||chr(10)||'perform public.conference_require_confirmed_user();','i');
      execute definition;
    end if;
  end loop;
  definition=pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('conference_validate_input' in definition)=0 then
    marker='if tid is null then raise exception ''Equipe não autorizada''; end if;';
    if position(marker in definition)=0 then raise exception 'Unexpected save version'; end if;
    definition=replace(definition,marker,marker||chr(10)||'perform public.conference_require_confirmed_user(); perform public.conference_validate_input(base_data); perform public.conference_validate_input(next_data);');
    execute definition;
  end if;
  definition=pg_get_functiondef('public.save_conference(bigint,jsonb)'::regprocedure);
  if position('conference_validate_input' in definition)=0 then
    marker='insert into public.conference_states(user_id) values(auth.uid()) on conflict do nothing;';
    if position(marker in definition)=0 then raise exception 'Unexpected legacy save version'; end if;
    execute replace(definition,marker,'perform public.conference_validate_input(next_data);'||chr(10)||marker);
  end if;
end
$migration$;
commit;
