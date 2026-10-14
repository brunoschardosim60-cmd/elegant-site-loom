-- Corrections preserve receipt times and link the original audit after renumbering.
create or replace function public.save_team_conference(base_data jsonb,next_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid; oid uuid; old_data jsonb; merged jsonb; new_revision bigint; m jsonb; old_m jsonb; d jsonb; old_d jsonb; docs jsonb; pres jsonb='[]'; event text; em text; stamp timestamptz=clock_timestamp();
begin
  select t.id,t.owner_id into tid,oid from public.conference_teams t join public.conference_members mem on mem.team_id=t.id where mem.user_id=auth.uid() for update of t;
  if tid is null then raise exception 'Equipe não autorizada'; end if;
  select lower(email) into em from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if em is null then raise exception 'Authentication required'; end if;
  select data into old_data from public.conference_states where user_id=oid for update;
  -- A CTC identity correction cannot merge with a simultaneous receipt of that old identity.
  if exists(select 1 from jsonb_array_elements(base_data->'manifests') bm cross join lateral jsonb_array_elements(bm->'documents') bd
    join (select nd from jsonb_array_elements(next_data->'manifests') nm cross join lateral jsonb_array_elements(nm->'documents') nd) incoming on incoming.nd->>'id'=bd->>'id'
    join (select rd from jsonb_array_elements(old_data->'manifests') rm cross join lateral jsonb_array_elements(rm->'documents') rd) remote on remote.rd->>'id'=bd->>'id'
    where ((bd->'ctc' is distinct from incoming.nd->'ctc') and (bd->'received' is distinct from remote.rd->'received'))
      or ((bd->'ctc' is distinct from remote.rd->'ctc') and (bd->'received' is distinct from incoming.nd->'received'))) then raise exception 'CONFERENCE_CONFLICT'; end if;
  merged=public.conference_merge(base_data,next_data,old_data);
  if jsonb_typeof(merged) is distinct from 'object' or jsonb_typeof(merged->'manifests') is distinct from 'array' or jsonb_typeof(merged->'activity') is distinct from 'array' or jsonb_typeof(merged->'issues') is distinct from 'array' or octet_length(merged::text)>=5000000 then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') x where coalesce(x->>'id','') !~ '^DI[0-9]{8,12}$' or nullif(x->>'driver','') is null or nullif(x->>'plate','') is null or jsonb_typeof(x->'date') is distinct from 'string' or jsonb_typeof(x->'documents') is distinct from 'array') then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') x where jsonb_array_length(x->'documents')=0 or (x ? 'issueDate' and (jsonb_typeof(x->'issueDate') is distinct from 'string' or x->>'issueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) or (x ? 'sourcePhotoHashes' and jsonb_typeof(x->'sourcePhotoHashes') is distinct from 'array')) then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') mi cross join lateral jsonb_array_elements(mi->'documents') di where coalesce(di->>'ctc','') !~ '^[0-9]{10}$' or nullif(di->>'id','') is null or jsonb_typeof(di->'nf') is distinct from 'string' or (di ? 'client' and jsonb_typeof(di->'client') is distinct from 'string') or (di ? 'recipient' and jsonb_typeof(di->'recipient') is distinct from 'string') or jsonb_typeof(di->'received') is distinct from 'boolean' or jsonb_typeof(di->'volumes') is distinct from 'number' or (di->>'volumes')::numeric<1 or trunc((di->>'volumes')::numeric)<>(di->>'volumes')::numeric) then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') mi cross join lateral jsonb_array_elements(coalesce(mi->'sourcePhotoHashes','[]')) h where jsonb_typeof(h) is distinct from 'string' or h #>> '{}' !~ '^[a-fA-F0-9]{64}$') then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'activity'||merged->'issues') x where (jsonb_typeof(x->'id') is distinct from 'number' and (jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) or jsonb_typeof(x->'title') is distinct from 'string' or jsonb_typeof(x->'description') is distinct from 'string' or jsonb_typeof(x->'time') is distinct from 'string' or (x ? 'warning' and jsonb_typeof(x->'warning') is distinct from 'boolean') or (x ? 'at' and (jsonb_typeof(x->'at') is distinct from 'string' or x->>'at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$'))) then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') mi group by mi->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(merged->'manifests') mi cross join lateral jsonb_array_elements(mi->'documents') di group by di->>'ctc' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(merged->'manifests') mi cross join lateral jsonb_array_elements(mi->'documents') di group by di->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(merged->'manifests') mi cross join lateral jsonb_array_elements_text(coalesce(mi->'sourcePhotoHashes','[]')) h group by lower(h) having count(*)>1)
    then raise exception 'CONFERENCE_DUPLICATE'; end if;

  if exists(select 1 from jsonb_array_elements(merged->'manifests') x where (x ? 'previousIds' and jsonb_typeof(x->'previousIds') is distinct from 'array') or (x ? 'expectedRows' and (jsonb_typeof(x->'expectedRows') is distinct from 'number' or (x->>'expectedRows')::numeric not between 0 and 300 or trunc((x->>'expectedRows')::numeric)<>(x->>'expectedRows')::numeric)) or (x ? 'totalVolumes' and (jsonb_typeof(x->'totalVolumes') is distinct from 'number' or (x->>'totalVolumes')::numeric not between 0 and 1000000 or trunc((x->>'totalVolumes')::numeric)<>(x->>'totalVolumes')::numeric)) or (x ? 'totalsReviewed' and jsonb_typeof(x->'totalsReviewed') is distinct from 'boolean')) then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') mi cross join lateral jsonb_array_elements(coalesce(mi->'previousIds','[]')) x where jsonb_typeof(x) is distinct from 'string' or x #>> '{}' !~ '^DI[0-9]{8,12}$') then raise exception 'CONFERENCE_INVALID'; end if;
  for m in select value from jsonb_array_elements(merged->'manifests') loop
    if m ? 'issueDate' then perform (m->>'issueDate')::date; end if;
    select value into old_m from jsonb_array_elements(old_data->'manifests') where value->>'id'=m->>'id';
    if old_m is null and jsonb_array_length(coalesce(m->'previousIds','[]'))>0 then
      select value into old_m from jsonb_array_elements(old_data->'manifests') where value->>'id'=m->'previousIds'->>-1;
      if old_m is null or exists(select 1 from jsonb_array_elements(merged->'manifests') x where x->>'id'=old_m->>'id')
        or (select jsonb_agg(x->>'id' order by x->>'id') from jsonb_array_elements(old_m->'documents') x) is distinct from (select jsonb_agg(x->>'id' order by x->>'id') from jsonb_array_elements(m->'documents') x)
        or coalesce(old_m->'previousIds','[]') is distinct from (m->'previousIds')- (jsonb_array_length(m->'previousIds')-1)
      then raise exception 'CONFERENCE_CONFLICT'; end if;
    end if;
    if old_m is not null and old_m->>'id'=m->>'id' and coalesce(old_m->'previousIds','[]') is distinct from coalesce(m->'previousIds','[]') then raise exception 'CONFERENCE_CONFLICT'; end if;
    if (old_m is null or old_m->'documents' is distinct from m->'documents' or old_m->'expectedRows' is distinct from m->'expectedRows' or old_m->'totalVolumes' is distinct from m->'totalVolumes') and coalesce(m->'totalsReviewed','false') <> 'true'::jsonb and ((coalesce((m->>'expectedRows')::numeric,0)>0 and (m->>'expectedRows')::numeric<>(select count(distinct x->>'ctc') from jsonb_array_elements(m->'documents') x)) or (coalesce((m->>'totalVolumes')::numeric,0)>0 and (m->>'totalVolumes')::numeric<>(select sum((x->>'volumes')::numeric) from jsonb_array_elements(m->'documents') x))) then raise exception 'CONFERENCE_TOTALS_REVIEW'; end if;
    docs='[]';
    for d in select value from jsonb_array_elements(m->'documents') loop
      select value into old_d from jsonb_array_elements(coalesce(old_m->'documents','[]')) where value->>'id'=d->>'id';
      if old_d->'received'='true'::jsonb and old_d->'ctc' is distinct from d->'ctc' then raise exception 'CONFERENCE_CONFLICT'; end if;
      if d->'received'='true'::jsonb then
        d=jsonb_set(d,'{receivedAt}',case when old_d->'received'='true'::jsonb then coalesce(old_d->'receivedAt',to_jsonb(stamp)) else to_jsonb(stamp) end);
      else d=d-'receivedAt'; end if;
      docs=docs||jsonb_build_array(d);
    end loop;
    m=jsonb_set(m,'{documents}',docs)-'finishedAt';
    if not exists(select 1 from jsonb_array_elements(docs) x where x->'received'<>'true'::jsonb) then m=m||jsonb_build_object('finishedAt',coalesce(old_m->'finishedAt',to_jsonb(stamp))); end if;
    pres=pres||jsonb_build_array(m);
  end loop;
  merged=jsonb_set(merged,'{manifests}',pres);
  merged=jsonb_set(merged,'{activity}',(select coalesce(jsonb_agg(value order by value->>'at' desc nulls last),'[]') from (select value from jsonb_array_elements(merged->'activity') order by value->>'at' desc nulls last limit 20) recent));
  -- Audit comes from the actual committed diff and authenticated identity,
  -- never from a name supplied by a browser. Repeated scans create no event.
  for m in select value from jsonb_array_elements(pres) loop
    select value into old_m from jsonb_array_elements(old_data->'manifests') where value->>'id'=m->>'id';
    if old_m is null and jsonb_array_length(coalesce(m->'previousIds','[]'))>0 then
      select value into old_m from jsonb_array_elements(old_data->'manifests') where value->>'id'=m->'previousIds'->>-1;
      if old_m is null or exists(select 1 from jsonb_array_elements(merged->'manifests') x where x->>'id'=old_m->>'id')
        or (select jsonb_agg(x->>'id' order by x->>'id') from jsonb_array_elements(old_m->'documents') x) is distinct from (select jsonb_agg(x->>'id' order by x->>'id') from jsonb_array_elements(m->'documents') x)
        or coalesce(old_m->'previousIds','[]') is distinct from (m->'previousIds')- (jsonb_array_length(m->'previousIds')-1)
      then raise exception 'CONFERENCE_CONFLICT'; end if;
    end if;
    if old_m is null then
      insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action,details) values(tid,auth.uid(),em,m->>'id','pre_added',jsonb_build_object('after',m));
    elsif (old_m-'documents'-'finishedAt') is distinct from (m-'documents'-'finishedAt') then
      insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action,details) values(tid,auth.uid(),em,m->>'id','pre_edited',jsonb_build_object('before',old_m-'documents','after',m-'documents'));
    end if;
    for d in select value from jsonb_array_elements(m->'documents') loop
      select value into old_d from jsonb_array_elements(coalesce(old_m->'documents','[]')) where value->>'id'=d->>'id';
      event=case when old_d is null then 'ctc_added' when old_d->'received' is distinct from d->'received' then case when d->'received'='true'::jsonb then 'ctc_received' else 'ctc_reopened' end when old_d is distinct from d then 'ctc_edited' else null end;
      if event is not null then insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action,details) values(tid,auth.uid(),em,m->>'id',event,jsonb_build_object('ctc',d->>'ctc','before',old_d,'after',d)); end if;
    end loop;
    for old_d in select value from jsonb_array_elements(coalesce(old_m->'documents','[]')) loop
      if not exists(select 1 from jsonb_array_elements(m->'documents') x where x->>'id'=old_d->>'id') then insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action,details) values(tid,auth.uid(),em,m->>'id','ctc_removed',jsonb_build_object('ctc',old_d->>'ctc','before',old_d)); end if;
    end loop;
    if old_m->'finishedAt' is null and m->'finishedAt' is not null then event='pre_finished';
    elsif old_m->'finishedAt' is not null and m->'finishedAt' is null then event='pre_reopened'; else event=null; end if;
    if event is not null then insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action) values(tid,auth.uid(),em,m->>'id',event); end if;
  end loop;
  for old_m in select value from jsonb_array_elements(old_data->'manifests') loop
    if not exists(select 1 from jsonb_array_elements(pres) x where x->>'id'=old_m->>'id' or coalesce(x->'previousIds','[]') ? (old_m->>'id')) then insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action,details) values(tid,auth.uid(),em,old_m->>'id','pre_removed',jsonb_build_object('before',old_m)); end if;
  end loop;
  if merged is distinct from old_data then update public.conference_states set data=merged,revision=revision+1,updated_at=stamp where user_id=oid; end if;
  select revision into new_revision from public.conference_states where user_id=oid;
  return jsonb_build_object('revision',new_revision,'data',merged);
end $$;

create or replace function public.get_conference_audit(pre_id text default null,before_id bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid; aliases jsonb;
begin
  select team_id into tid from public.conference_members where user_id=auth.uid();
  if tid is null then raise exception 'Equipe não autorizada'; end if;
  select coalesce(value->'previousIds','[]') into aliases from public.conference_states s join public.conference_teams t on t.owner_id=s.user_id cross join lateral jsonb_array_elements(s.data->'manifests') where t.id=tid and value->>'id'=pre_id;
  return (select coalesce(jsonb_agg(to_jsonb(a) order by id desc),'[]') from
    (select id,actor_email,occurred_at,manifest_id,action,details from public.conference_audit where team_id=tid and (pre_id is null or manifest_id=pre_id or coalesce(aliases,'[]') ? manifest_id) and (before_id is null or id<before_id) order by id desc limit 100) a);
end $$;

