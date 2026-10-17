-- One canonical manifesto/receipt, optionally shown in several personal views.
-- Team membership/RLS and immutable creator attribution remain unchanged.
begin;
create or replace function public.conference_manifest_demands(candidate jsonb, original jsonb, actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare ids jsonb;
begin
  -- Only the authenticated member may add themselves. Old browsers cannot erase
  -- links they do not understand. Concurrent additions are merged as a set.
  if exists(select 1 from jsonb_array_elements_text(coalesce(candidate->'demandUserIds','[]')) id
    where id<>actor::text and not coalesce(original->'demandUserIds','[]') ? id) then
    raise exception 'CONFERENCE_INVALID';
  end if;
  select coalesce(jsonb_agg(id order by id),'[]') into ids from (
    select distinct value as id from jsonb_array_elements(coalesce(original->'demandUserIds','[]')||coalesce(candidate->'demandUserIds','[]'))
  ) entries;
  if jsonb_array_length(ids)=0 then return candidate-'demandUserIds'; end if;
  return jsonb_set(candidate,'{demandUserIds}',ids);
end $$;
revoke all on function public.conference_manifest_demands(jsonb,jsonb,uuid) from public,anon,authenticated;

do $migration$
declare definition text; marker text;
begin
  definition=pg_get_functiondef('public.conference_merge(jsonb,jsonb,jsonb)'::regprocedure);
  if position('demandUserIds' in definition)=0 then
    marker='if k=''receivedAt''';
    if position(marker in definition)=0 then raise exception 'Unexpected merge version'; end if;
    execute replace(definition,marker,$union$
      if k='demandUserIds' and l ? 'documents' and r ? 'documents' then
        select coalesce(jsonb_agg(value order by value),'[]') into v from (
          select distinct value from jsonb_array_elements(coalesce(l->k,'[]')||coalesce(r->k,'[]'))
        ) linked;
        result=result||jsonb_build_object(k,v);
        continue;
      end if;
    $union$||marker);
  end if;
  definition=pg_get_functiondef('public.conference_validate_input(jsonb)'::regprocedure);
  if position('demandUserIds' in definition)=0 then
    definition=replace(definition,'''finishedAt'']','''finishedAt'',''demandUserIds'']');
    definition=replace(definition,'''documents'',''previousIds'',''sourcePhotoHashes'')','''documents'',''previousIds'',''sourcePhotoHashes'',''demandUserIds'')');
    marker='-- Every non-array manifest field is scalar.';
    if position(marker in definition)=0 then raise exception 'Unexpected validator version'; end if;
    definition=replace(definition,marker,$guard$
      if m ? 'demandUserIds' then
        if jsonb_typeof(m->'demandUserIds')<>'array' then raise exception 'CONFERENCE_INVALID'; end if;
        if jsonb_array_length(m->'demandUserIds')>1000 or exists(select 1 from jsonb_array_elements(m->'demandUserIds') where jsonb_typeof(value)<>'string' or value #>> '{}' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then raise exception 'CONFERENCE_INVALID'; end if;
      end if;
    $guard$||marker);
    execute definition;
  end if;
  definition=pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('conference_manifest_demands' in definition)=0 then
    marker='m=public.conference_manifest_creator(tid,m,old_m,auth.uid(),em);';
    if position(marker in definition)=0 then raise exception 'Unexpected creator version'; end if;
    execute replace(definition,marker,'m=public.conference_manifest_demands(m,old_m,auth.uid());'||chr(10)||marker);
  end if;
  definition=pg_get_functiondef('public.get_conference_team(boolean)'::regprocedure);
  if position('''sharedDemands''' in definition)=0 then
    marker='''teamId'',tid';
    if position(marker in definition)=0 then raise exception 'Unexpected team version'; end if;
    execute replace(definition,marker,'''sharedDemands'',true,'||marker);
  end if;
  -- Do not allow pre-team legacy snapshots to seed another member's demands.
  definition=pg_get_functiondef('public.save_conference(bigint,jsonb)'::regprocedure);
  if position('legacy_creator_entry-''demandUserIds''' in definition)=0 then
    marker='legacy_creator_entry-''createdBy''-''createdByEmail''';
    if position(marker in definition)=0 then raise exception 'Unexpected legacy creator version'; end if;
    execute replace(definition,marker,'legacy_creator_entry-''demandUserIds''-''createdBy''-''createdByEmail''');
  end if;
end $migration$;
commit;
