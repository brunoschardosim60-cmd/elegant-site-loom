-- Personal and team views use one canonical state. Authenticated creators are
-- server assigned and immutable; invitation, membership and RLS stay unchanged.
create or replace function public.conference_manifest_creator(
  team_key uuid, candidate jsonb, original jsonb, current_actor uuid, current_email text
) returns jsonb language plpgsql set search_path='' as $$
declare creator_id uuid; creator_email text; identity_data jsonb;
begin
  if original is null then
    creator_id=current_actor; creator_email=current_email;
  elsif nullif(original->>'createdByEmail','') is not null then
    creator_id=(original->>'createdBy')::uuid; creator_email=original->>'createdByEmail';
  else
    -- Match stable document IDs too, so a deleted/reused manifesto number does
    -- not inherit the author of an unrelated, older registration.
    select a.actor_id,a.actor_email into creator_id,creator_email
    from public.conference_audit a
    where a.team_id=team_key and a.action='pre_added'
      and (a.manifest_id=original->>'id' or coalesce(original->'previousIds','[]') ? a.manifest_id)
      and exists(select 1 from jsonb_array_elements(coalesce(a.details->'after'->'documents','[]')) added_doc
        join jsonb_array_elements(original->'documents') existing_doc
          on added_doc->>'id'=existing_doc->>'id')
    order by a.id desc limit 1;
    if creator_email is null then
      -- Pre-team records originated in the team owner's personal state.
      select t.owner_id,lower(u.email) into creator_id,creator_email
      from public.conference_teams t join auth.users u on u.id=t.owner_id where t.id=team_key;
    end if;
  end if;
  identity_data=jsonb_build_object('createdByEmail',lower(creator_email));
  if creator_id is not null then identity_data=identity_data||jsonb_build_object('createdBy',creator_id); end if;
  return (candidate-'createdBy'-'createdByEmail')||identity_data;
end $$;
revoke all on function public.conference_manifest_creator(uuid,jsonb,jsonb,uuid,text) from public,anon,authenticated;

do $migration$
declare definition text;
  marker text := 'if (old_m is null or old_m->''documents'' is distinct from m->''documents''';
  read_marker text := 'select s.revision,s.data into revision,payload from public.conference_states s where s.user_id=own.owner_id;';
  read_stamp text := $read$
  select s.revision,s.data into revision,payload from public.conference_states s where s.user_id=own.owner_id for update;
  if jsonb_typeof(payload->'manifests')='array' and exists(select 1 from jsonb_array_elements(payload->'manifests') legacy_manifest where not legacy_manifest ? 'createdByEmail') then
    payload=jsonb_set(payload,'{manifests}',(select jsonb_agg(public.conference_manifest_creator(tid,legacy_manifest,legacy_manifest,null,null) order by ordinal) from jsonb_array_elements(payload->'manifests') with ordinality entries(legacy_manifest,ordinal)));
    update public.conference_states creator_state set data=payload,revision=creator_state.revision+1,updated_at=clock_timestamp() where creator_state.user_id=own.owner_id returning creator_state.revision into revision;
  end if;
  $read$;
begin
  definition=pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('conference_manifest_creator' in definition)=0 then
    if position(marker in definition)=0 then raise exception 'Unexpected conference RPC version; review creator assignment'; end if;
    execute replace(definition,marker,'m=public.conference_manifest_creator(tid,m,old_m,auth.uid(),em);' || chr(10) || '    ' || marker);
  end if;
  definition=pg_get_functiondef('public.get_conference_team(boolean)'::regprocedure);
  if position('''userId'',m.user_id' in definition)=0 then
    if position('''email'',m.email,''owner''' in definition)=0 then raise exception 'Unexpected team RPC version'; end if;
    definition=replace(definition,'''email'',m.email,''owner''','''email'',m.email,''userId'',m.user_id,''owner''');
  end if;
  if position('conference_manifest_creator' in definition)=0 then
    if position(read_marker in definition)=0 then raise exception 'Unexpected personal state initialization version'; end if;
    definition=replace(definition,read_marker,read_stamp);
  end if;
  execute definition;
  -- Pre-team legacy writes cannot seed a fabricated creator for a future team.
  definition=pg_get_functiondef('public.save_conference(bigint,jsonb)'::regprocedure);
  if position('legacy_creator_entry' in definition)=0 then
    marker='insert into public.conference_states(user_id) values(auth.uid()) on conflict do nothing;';
    if position(marker in definition)=0 then raise exception 'Unexpected legacy state writer version'; end if;
    execute replace(definition,marker,$legacy$
      if jsonb_typeof(next_data->'manifests')='array' then
        next_data=jsonb_set(next_data,'{manifests}',coalesce((select jsonb_agg(legacy_creator_entry-'createdBy'-'createdByEmail' order by ordinal) from jsonb_array_elements(next_data->'manifests') with ordinality entries(legacy_creator_entry,ordinal)),'[]'));
      end if;
    $legacy$ || marker);
  end if;
end
$migration$;

-- Metadata-only backfill: no receipt, NF, date, author audit or membership changes.
with attributed as (
  select s.user_id,jsonb_set(s.data,'{manifests}',coalesce((select jsonb_agg(
    public.conference_manifest_creator(t.id,item,item,null,null) order by ordinal)
    from jsonb_array_elements(s.data->'manifests') with ordinality entries(item,ordinal)),'[]')) as data
  from public.conference_states s join public.conference_teams t on t.owner_id=s.user_id
)
update public.conference_states s set data=a.data,revision=s.revision+1,updated_at=clock_timestamp()
from attributed a where s.user_id=a.user_id and s.data is distinct from a.data;
