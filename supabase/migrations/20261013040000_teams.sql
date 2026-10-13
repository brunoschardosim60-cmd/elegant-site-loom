-- Shared workspaces retain the owner's existing records. Joining requires an
-- invitation for the authenticated, confirmed email; never share by public login.
begin;
create table public.conference_teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Equipe confere.', created_at timestamptz not null default now()
);
create table public.conference_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.conference_teams(id) on delete cascade,
  email text not null, joined_at timestamptz not null default now()
);
create table public.conference_invites (
  team_id uuid not null references public.conference_teams(id) on delete cascade,
  email text not null, created_at timestamptz not null default now(), primary key(team_id,email)
);
create table public.conference_audit (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.conference_teams(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null, occurred_at timestamptz not null default now(),
  manifest_id text not null, action text not null, details jsonb not null default '{}'
);
create index conference_audit_lookup on public.conference_audit(team_id,manifest_id,id desc);
alter table public.conference_teams enable row level security;
alter table public.conference_members enable row level security;
alter table public.conference_invites enable row level security;
alter table public.conference_audit enable row level security;
revoke all on public.conference_teams,public.conference_members,public.conference_invites,public.conference_audit from anon,authenticated;

-- Three-way merge: only changed fields are applied. Arrays of records use IDs,
-- not positions. An edit versus a deletion or conflicting field is rejected.
create function public.conference_merge(b jsonb,l jsonb,r jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare k text; v jsonb; result jsonb; item jsonb; bv jsonb; lv jsonb; rv jsonb;
begin
  if l is not distinct from b then return r; end if;
  if r is not distinct from b or l is not distinct from r then return l; end if;
  if b is null or l is null or r is null then raise exception 'CONFERENCE_CONFLICT'; end if;
  if jsonb_typeof(b)='object' and jsonb_typeof(l)='object' and jsonb_typeof(r)='object' then
    result='{}';
    for k in select jsonb_object_keys(b) union select jsonb_object_keys(l) union select jsonb_object_keys(r) loop
      -- Completion and receipt timestamps are derived on the server below.
      if k='finishedAt' and l ? 'documents' and r ? 'documents' then continue; end if;
      if k='receivedAt' and l->'received'=r->'received' then
        v=case when r->'received'='true'::jsonb then coalesce(r->k,l->k) else null end;
      else v=public.conference_merge(b->k,l->k,r->k); end if;
      if v is not null then result=result||jsonb_build_object(k,v); end if;
    end loop;
    return result;
  end if;
  if jsonb_typeof(b)='array' and jsonb_typeof(l)='array' and jsonb_typeof(r)='array' then
    if not exists(select 1 from jsonb_array_elements(b||l||r) x where jsonb_typeof(x)<>'object' or not x ? 'id') then
      result='[]';
      for item in select value from jsonb_array_elements(r||l) with ordinality order by ordinality loop
        k=item->>'id';
        if exists(select 1 from jsonb_array_elements(result) x where x->>'id'=k) then continue; end if;
        select value into bv from jsonb_array_elements(b) where value->>'id'=k;
        select value into lv from jsonb_array_elements(l) where value->>'id'=k;
        select value into rv from jsonb_array_elements(r) where value->>'id'=k;
        v=public.conference_merge(bv,lv,rv);
        if v is not null then result=result||jsonb_build_array(v); end if;
      end loop;
      return result;
    elsif not exists(select 1 from jsonb_array_elements(b||l||r) x where jsonb_typeof(x)<>'string') then
      select coalesce(jsonb_agg(value order by value),'[]') into result from (select distinct value from jsonb_array_elements(l||r)) s;
      return result;
    end if;
  end if;
  raise exception 'CONFERENCE_CONFLICT';
end $$;
revoke all on function public.conference_merge(jsonb,jsonb,jsonb) from public,anon,authenticated;

create function public.get_conference_team(accept_invitation boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid(); em text; tid uuid; own public.conference_teams; revision bigint; payload jsonb; invitation jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select lower(email) into em from auth.users where id=uid and email_confirmed_at is not null;
  if em is null then raise exception 'Confirme seu email'; end if;
  -- Invitations are accepted by confirmed email only. Lock the team before
  -- membership changes so simultaneous joins cannot exceed three people.
  if accept_invitation then select i.team_id into tid from public.conference_invites i where i.email=em order by i.created_at limit 1; end if;
  if tid is not null then
    perform 1 from public.conference_teams where id=tid for update;
    select t.* into own from public.conference_teams t join public.conference_members m on m.team_id=t.id where m.user_id=uid;
    if own.id is not null and own.id<>tid then
      if own.owner_id<>uid or (select count(*) from public.conference_members where team_id=own.id)>1
        then raise exception 'Já participa de outra equipe'; end if;
      -- Keep the former personal data intact. It is never silently merged.
      delete from public.conference_members where user_id=uid;
    end if;
    if (select count(*) from public.conference_members where team_id=tid)>=3 and not exists(select 1 from public.conference_members where user_id=uid and team_id=tid)
      then raise exception 'Equipe completa (3 pessoas)'; end if;
    insert into public.conference_members(user_id,team_id,email) values(uid,tid,em) on conflict(user_id) do nothing;
    delete from public.conference_invites where team_id=tid and email=em;
  end if;
  select team_id into tid from public.conference_members where user_id=uid;
  if tid is null then
    insert into public.conference_teams(owner_id) values(uid) on conflict(owner_id) do nothing;
    select id into tid from public.conference_teams where owner_id=uid for update;
    insert into public.conference_members(user_id,team_id,email) values(uid,tid,em) on conflict(user_id) do nothing;
  end if;
  select * into own from public.conference_teams where id=tid;
  insert into public.conference_states(user_id) values(own.owner_id) on conflict do nothing;
  select s.revision,s.data into revision,payload from public.conference_states s where s.user_id=own.owner_id;
  select jsonb_build_object('ownerEmail',u.email) into invitation from public.conference_invites i join public.conference_teams t on t.id=i.team_id join auth.users u on u.id=t.owner_id where i.email=em order by i.created_at limit 1;
  return jsonb_build_object('teamId',tid,'name',own.name,'owner',own.owner_id=uid,'revision',revision,'data',payload,'invitation',invitation,
    'members',(select coalesce(jsonb_agg(jsonb_build_object('email',m.email,'owner',m.user_id=own.owner_id,'pending',false) order by m.joined_at),'[]') from public.conference_members m where m.team_id=tid)
      ||(select coalesce(jsonb_agg(jsonb_build_object('email',i.email,'owner',false,'pending',true) order by i.created_at),'[]') from public.conference_invites i where i.team_id=tid));
end $$;

create function public.invite_conference_member(member_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid; em text=lower(trim(member_email));
begin
  select t.id into tid from public.conference_teams t join public.conference_members m on m.team_id=t.id where m.user_id=auth.uid() and t.owner_id=auth.uid() for update of t;
  if tid is null then raise exception 'Somente o responsável pode convidar'; end if;
  if length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Confira o email'; end if;
  if exists(select 1 from public.conference_members where team_id=tid and email=em) or exists(select 1 from public.conference_invites where team_id=tid and email=em) then raise exception 'Email já incluído'; end if;
  if (select count(*) from public.conference_members where team_id=tid)+(select count(*) from public.conference_invites where team_id=tid)>=3 then raise exception 'Equipe completa (3 pessoas)'; end if;
  if exists(select 1 from public.conference_invites where email=em and team_id<>tid) then raise exception 'Email já convidado para outra equipe'; end if;
  if exists(select 1 from public.conference_members m join public.conference_teams t on t.id=m.team_id where m.email=em and m.team_id<>tid and (t.owner_id<>m.user_id or (select count(*) from public.conference_members others where others.team_id=t.id)>1)) then raise exception 'Email já participa de outra equipe'; end if;
  insert into public.conference_invites(team_id,email) values(tid,em);
  return public.get_conference_team();
end $$;
create function public.cancel_conference_invite(member_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
  select t.id into tid from public.conference_teams t join public.conference_members m on m.team_id=t.id where m.user_id=auth.uid() and t.owner_id=auth.uid() for update of t;
  if tid is null then raise exception 'Somente o responsável pode convidar'; end if;
  delete from public.conference_invites where team_id=tid and email=lower(trim(member_email));
  return public.get_conference_team();
end $$;

-- Poll the revision only; do not download the whole conference every 2s.
create function public.get_conference_revision() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  select jsonb_build_object('teamId',t.id,'revision',s.revision) into result from public.conference_members m join public.conference_teams t on t.id=m.team_id join public.conference_states s on s.user_id=t.owner_id where m.user_id=auth.uid();
  if result is null then raise exception 'Equipe não autorizada'; end if;
  return result;
end $$;

create function public.save_team_conference(base_data jsonb,next_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid; oid uuid; old_data jsonb; merged jsonb; new_revision bigint; m jsonb; old_m jsonb; d jsonb; old_d jsonb; docs jsonb; pres jsonb='[]'; event text; em text; stamp timestamptz=clock_timestamp();
begin
  select t.id,t.owner_id into tid,oid from public.conference_teams t join public.conference_members mem on mem.team_id=t.id where mem.user_id=auth.uid() for update of t;
  if tid is null then raise exception 'Equipe não autorizada'; end if;
  select lower(email) into em from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if em is null then raise exception 'Authentication required'; end if;
  select data into old_data from public.conference_states where user_id=oid for update;
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
  for m in select value from jsonb_array_elements(merged->'manifests') loop
    if m ? 'issueDate' then perform (m->>'issueDate')::date; end if;
    select value into old_m from jsonb_array_elements(old_data->'manifests') where value->>'id'=m->>'id';
    docs='[]';
    for d in select value from jsonb_array_elements(m->'documents') loop
      select value into old_d from jsonb_array_elements(coalesce(old_m->'documents','[]')) where value->>'id'=d->>'id';
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
    if not exists(select 1 from jsonb_array_elements(pres) x where x->>'id'=old_m->>'id') then insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action,details) values(tid,auth.uid(),em,old_m->>'id','pre_removed',jsonb_build_object('before',old_m)); end if;
  end loop;
  if merged is distinct from old_data then update public.conference_states set data=merged,revision=revision+1,updated_at=stamp where user_id=oid; end if;
  select revision into new_revision from public.conference_states where user_id=oid;
  return jsonb_build_object('revision',new_revision,'data',merged);
end $$;

create function public.get_conference_audit(pre_id text default null,before_id bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
  select team_id into tid from public.conference_members where user_id=auth.uid();
  if tid is null then raise exception 'Equipe não autorizada'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(a) order by id desc),'[]') from
    (select id,actor_email,occurred_at,manifest_id,action,details from public.conference_audit where team_id=tid and (pre_id is null or manifest_id=pre_id) and (before_id is null or id<before_id) order by id desc limit 100) a);
end $$;

-- Old tabs cannot overwrite a shared workspace using the previous whole-state
-- revision endpoint. They must reload once after this migration.
create or replace function public.save_conference(expected_revision bigint,next_data jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare nr bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.conference_members where user_id=auth.uid()) then raise exception 'CONFERENCE_TEAM_RELOAD'; end if;
  insert into public.conference_states(user_id) values(auth.uid()) on conflict do nothing;
  update public.conference_states set data=next_data,revision=revision+1,updated_at=now() where user_id=auth.uid() and revision=expected_revision returning revision into nr;
  if nr is null then raise exception 'CONFERENCE_CONFLICT'; end if;
  return nr;
end $$;
-- Block direct legacy writes once an account participates in a team.
drop policy "Create own conference" on public.conference_states;
drop policy "Update own conference" on public.conference_states;
revoke insert,update on public.conference_states from authenticated;
revoke all on function public.get_conference_revision(),public.get_conference_team(boolean),public.invite_conference_member(text),public.cancel_conference_invite(text),public.save_team_conference(jsonb,jsonb),public.get_conference_audit(text,bigint) from public,anon;
grant execute on function public.get_conference_revision(),public.get_conference_team(boolean),public.invite_conference_member(text),public.cancel_conference_invite(text),public.save_team_conference(jsonb,jsonb),public.get_conference_audit(text,bigint) to authenticated;
commit;
