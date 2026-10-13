-- No fixed team size. Access still requires a confirmed, explicitly invited account.
-- Preserve existing records, RLS, RPC grants and immutable audit.
begin;
create or replace function public.conference_merge(b jsonb,l jsonb,r jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare k text; v jsonb; result jsonb; item jsonb; bv jsonb; lv jsonb; rv jsonb;
begin
  if l is not distinct from b then return r; end if;
  if r is not distinct from b or l is not distinct from r then return l; end if;
  if b is null and jsonb_typeof(l)='object' and jsonb_typeof(r)='object' and l ? 'id' and l->'id'=r->'id' then raise exception 'CONFERENCE_DUPLICATE'; end if;
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

create or replace function public.get_conference_team(accept_invitation boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid(); em text; tid uuid; own public.conference_teams; revision bigint; payload jsonb; invitation jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select lower(email) into em from auth.users where id=uid and email_confirmed_at is not null;
  if em is null then raise exception 'Confirme seu email'; end if;
  -- Invitations are accepted by confirmed email only. Lock the team before
  -- membership changes and preserve invitation consistency.
  if accept_invitation then select i.team_id into tid from public.conference_invites i where i.email=em order by i.created_at limit 1; end if;
  if tid is not null then
    perform 1 from public.conference_teams where id=tid for update;
    select t.* into own from public.conference_teams t join public.conference_members m on m.team_id=t.id where m.user_id=uid;
    if own.id is not null and own.id<>tid then
      if own.owner_id<>uid or (select count(*) from public.conference_members where team_id=own.id)>1 or exists(select 1 from public.conference_invites where team_id=own.id)
        then raise exception 'Já participa de outra equipe'; end if;
      -- Keep the former personal data intact. It is never silently merged.
      delete from public.conference_members where user_id=uid;
    end if;
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

create or replace function public.invite_conference_member(member_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid; em text=lower(trim(member_email));
begin
  select t.id into tid from public.conference_teams t join public.conference_members m on m.team_id=t.id where m.user_id=auth.uid() and t.owner_id=auth.uid() for update of t;
  if tid is null then raise exception 'Somente o responsável pode convidar'; end if;
  if length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Confira o email'; end if;
  if exists(select 1 from public.conference_members where team_id=tid and email=em) or exists(select 1 from public.conference_invites where team_id=tid and email=em) then raise exception 'Email já incluído'; end if;
  if exists(select 1 from public.conference_invites where email=em and team_id<>tid) then raise exception 'Email já convidado para outra equipe'; end if;
  if exists(select 1 from public.conference_members m join public.conference_teams t on t.id=m.team_id where m.email=em and m.team_id<>tid and (t.owner_id<>m.user_id or (select count(*) from public.conference_members others where others.team_id=t.id)>1 or exists(select 1 from public.conference_invites pending where pending.team_id=t.id))) then raise exception 'Email já participa de outra equipe'; end if;
  insert into public.conference_invites(team_id,email) values(tid,em);
  return public.get_conference_team();
end $$;
commit;
