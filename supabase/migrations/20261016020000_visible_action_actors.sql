-- Visible action attribution mirrors authenticated audit, independently of creator ownership.
create or replace function public.conference_manifest_actions(
  team_key uuid, candidate jsonb, original jsonb, current_actor uuid, current_email text, event_stamp timestamptz
) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; prior jsonb; result_docs jsonb='[]'; result jsonb;
  actor_id uuid; actor_email text; actor_stamp timestamptz; registered_stamp timestamptz;
begin
  for item in select value from jsonb_array_elements(candidate->'documents') loop
    select value into prior from jsonb_array_elements(coalesce(original->'documents','[]')) where value->>'id'=item->>'id';
    item=item-'receivedBy'-'receivedByEmail';
    if item->'received'='true'::jsonb then
      if current_actor is not null and coalesce(prior->'received','false')<>'true'::jsonb then
        item=item||jsonb_build_object('receivedBy',current_actor,'receivedByEmail',current_email);
      elsif prior->>'receivedByEmail' is not null then
        item=item||jsonb_strip_nulls(jsonb_build_object('receivedBy',prior->'receivedBy','receivedByEmail',prior->'receivedByEmail'));
      elsif current_actor is null then
        select a.actor_id,a.actor_email into actor_id,actor_email from public.conference_audit a
        where a.team_id=team_key and a.action='ctc_received'
          and (a.manifest_id=candidate->>'id' or coalesce(candidate->'previousIds','[]') ? a.manifest_id)
          and a.details->'after'->>'id'=item->>'id'
          and a.details->'after'->>'receivedAt'=item->>'receivedAt'
        order by a.id desc limit 1;
        if actor_email is not null then item=item||jsonb_strip_nulls(jsonb_build_object('receivedBy',actor_id,'receivedByEmail',actor_email)); end if;
      end if;
    end if;
    result_docs=result_docs||jsonb_build_array(item);
  end loop;
  result=jsonb_set(candidate-'updatedBy'-'updatedByEmail'-'updatedAt','{documents}',result_docs);
  if current_actor is not null and (original is null or result is distinct from (original-'updatedBy'-'updatedByEmail'-'updatedAt')) then
    result=result||jsonb_build_object('updatedBy',current_actor,'updatedByEmail',current_email,'updatedAt',event_stamp);
  elsif original->>'updatedByEmail' is not null then
    result=result||jsonb_strip_nulls(jsonb_build_object('updatedBy',original->'updatedBy','updatedByEmail',original->'updatedByEmail','updatedAt',original->'updatedAt'));
  elsif current_actor is null then
    begin registered_stamp=(candidate->>'date')::timestamptz; exception when others then registered_stamp=null; end;
    select a.actor_id,a.actor_email,a.occurred_at into actor_id,actor_email,actor_stamp
    from public.conference_audit a where a.team_id=team_key and a.action<>'pre_removed'
      and (a.manifest_id=candidate->>'id' or coalesce(candidate->'previousIds','[]') ? a.manifest_id)
      and a.occurred_at>=registered_stamp order by a.id desc limit 1;
    if actor_email is not null then result=result||jsonb_strip_nulls(jsonb_build_object('updatedBy',actor_id,'updatedByEmail',actor_email,'updatedAt',actor_stamp)); end if;
  end if;
  return result;
end $$;
revoke all on function public.conference_manifest_actions(uuid,jsonb,jsonb,uuid,text,timestamptz) from public,anon,authenticated;

create or replace function public.conference_strip_action_actors(payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; clean_item jsonb; result jsonb='[]';
begin
  if jsonb_typeof(payload->'manifests') is distinct from 'array' then return payload; end if;
  for item in select value from jsonb_array_elements(payload->'manifests') loop
    clean_item=item-'updatedBy'-'updatedByEmail'-'updatedAt';
    if jsonb_typeof(item->'documents')='array' then
      clean_item=jsonb_set(clean_item,'{documents}',coalesce((select jsonb_agg(doc-'receivedBy'-'receivedByEmail' order by ordinal) from jsonb_array_elements(item->'documents') with ordinality entries(doc,ordinal)),'[]'));
    end if;
    result=result||jsonb_build_array(clean_item);
  end loop;
  return jsonb_set(payload,'{manifests}',result);
end $$;
revoke all on function public.conference_strip_action_actors(jsonb) from public,anon,authenticated;

do $migration$
declare definition text; marker text;
begin
  definition=pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('conference_manifest_actions' in definition)=0 then
    marker='pres=pres||jsonb_build_array(m);';
    if position(marker in definition)=0 then raise exception 'Unexpected conference action version'; end if;
    definition=replace(definition,marker,'m=public.conference_manifest_actions(tid,m,old_m,auth.uid(),em,stamp);'||chr(10)||marker);
    definition=replace(definition,'(old_m-''documents''-''finishedAt'') is distinct from (m-''documents''-''finishedAt'')',
      '(old_m-''documents''-''finishedAt''-''updatedBy''-''updatedByEmail''-''updatedAt'') is distinct from (m-''documents''-''finishedAt''-''updatedBy''-''updatedByEmail''-''updatedAt'')');
    execute definition;
  end if;
  definition=pg_get_functiondef('public.save_conference(bigint,jsonb)'::regprocedure);
  if position('conference_strip_action_actors' in definition)=0 then
    marker='insert into public.conference_states(user_id) values(auth.uid()) on conflict do nothing;';
    if position(marker in definition)=0 then raise exception 'Unexpected legacy writer version'; end if;
    execute replace(definition,marker,'next_data=public.conference_strip_action_actors(next_data);'||chr(10)||marker);
  end if;
end
$migration$;

-- Recover only actions with evidence. No author or timestamp is invented for legacy receipts.
with attributed as (
  select s.user_id,jsonb_set(s.data,'{manifests}',coalesce((select jsonb_agg(
    public.conference_manifest_actions(t.id,item,item,null,null,null) order by ordinal)
    from jsonb_array_elements(s.data->'manifests') with ordinality entries(item,ordinal)),'[]')) as data
  from public.conference_states s join public.conference_teams t on t.owner_id=s.user_id
)
update public.conference_states s set data=a.data,revision=s.revision+1,updated_at=clock_timestamp()
from attributed a where s.user_id=a.user_id and s.data is distinct from a.data;
