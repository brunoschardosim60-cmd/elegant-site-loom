-- Access roles, invitation-only sign-up, per-team import settings and a
-- client error log. The large team and save RPCs are not rewritten: the team
-- loader gets a gate in front of it under its existing name, and saves go only
-- through save_team_conference_v2, which now enforces the caller's role.
--
-- Deploy order: apply 20261030020000_conference_archive.sql, deploy the app,
-- then apply this file. It revokes the original save RPCs, which older
-- deployed builds still call.
begin;

-- Roles. The team owner stays defined by conference_teams.owner_id.
alter table public.conference_members add column if not exists role text not null default 'conferente'
  check (role in ('admin', 'conferente', 'leitura'));

-- E-mails allowed to start a team of their own. Managed by the operator in the
-- Supabase SQL editor; no RPC writes it.
create table public.conference_owner_allowlist (
  email text primary key check (email = lower(email)),
  note text,
  added_at timestamptz not null default now()
);
alter table public.conference_owner_allowlist enable row level security;
revoke all on public.conference_owner_allowlist from public, anon, authenticated;

-- Which rows of the Luft 108 export belong to the team. Defaults reproduce the
-- former fixed filter (branch 06, reason DIS).
create table public.conference_team_settings (
  team_id uuid primary key references public.conference_teams(id) on delete cascade,
  branches text[] not null default '{06}',
  reasons text[] not null default '{DIS}',
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.conference_team_settings enable row level security;
revoke all on public.conference_team_settings from public, anon, authenticated;

create function public.conference_caller_role() returns text
language sql stable security definer set search_path='' as $$
  select case when t.owner_id = auth.uid() then 'owner' else m.role end
  from public.conference_members m join public.conference_teams t on t.id = m.team_id
  where m.user_id = auth.uid()
$$;
revoke all on function public.conference_caller_role() from public, anon, authenticated;

-- Gate in front of the team loader, keeping the name clients call.
alter function public.get_conference_team(boolean) rename to conference_team_core;
revoke all on function public.conference_team_core(boolean) from public, anon, authenticated;

create function public.get_conference_team(accept_invitation boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); em text; result jsonb; tid uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select lower(email) into em from auth.users where id = uid and email_confirmed_at is not null;
  if em is null then raise exception 'Confirme seu email'; end if;
  -- A new account needs an invitation or an operator-approved e-mail; it no
  -- longer receives a team (and database space) just by signing up.
  if not exists(select 1 from public.conference_members where user_id = uid)
    and not exists(select 1 from public.conference_invites where email = em)
    and not exists(select 1 from public.conference_owner_allowlist where email = em) then
    raise exception 'CONFERENCE_NOT_INVITED';
  end if;
  result := public.conference_team_core(accept_invitation);
  tid := (result->>'teamId')::uuid;
  return result || jsonb_build_object(
    'role', public.conference_caller_role(),
    'settings', coalesce(
      (select jsonb_build_object('branches', to_jsonb(s.branches), 'reasons', to_jsonb(s.reasons))
        from public.conference_team_settings s where s.team_id = tid),
      jsonb_build_object('branches', '["06"]'::jsonb, 'reasons', '["DIS"]'::jsonb)),
    'members', (
      select coalesce(jsonb_agg(
        case when x ? 'userId' then x || jsonb_build_object('role',
          (select case when t.owner_id = mm.user_id then 'owner' else mm.role end
             from public.conference_members mm join public.conference_teams t on t.id = mm.team_id
             where mm.user_id = (x->>'userId')::uuid))
        else x end order by ord), '[]')
      from jsonb_array_elements(result->'members') with ordinality e(x, ord)));
end $$;
revoke all on function public.get_conference_team(boolean) from public, anon;
grant execute on function public.get_conference_team(boolean) to authenticated;

-- Administrators may invite and cancel invitations, like the owner.
do $migration$
declare fn text; definition text;
  original text := 'where m.user_id=auth.uid() and t.owner_id=auth.uid() for update of t;';
  widened text := 'where m.user_id=auth.uid() and (t.owner_id=auth.uid() or m.role=''admin'') for update of t;';
begin
  foreach fn in array array['public.invite_conference_member(text)', 'public.cancel_conference_invite(text)'] loop
    definition := pg_get_functiondef(fn::regprocedure);
    if position(original in definition) = 0 then
      raise exception 'Unexpected % version; review the owner check before applying', fn;
    end if;
    execute replace(definition, original, widened);
  end loop;
end
$migration$;

create function public.set_conference_member_role(member_email text, new_role text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid; target uuid;
begin
  perform public.conference_require_confirmed_user();
  if new_role not in ('admin', 'conferente', 'leitura') then raise exception 'CONFERENCE_INVALID'; end if;
  select t.id into tid from public.conference_teams t where t.owner_id = auth.uid() for update;
  if tid is null then raise exception 'Somente o responsável pode alterar papéis'; end if;
  select m.user_id into target from public.conference_members m
    where m.team_id = tid and m.email = lower(trim(member_email)) and m.user_id <> auth.uid();
  if target is null then raise exception 'Integrante não encontrado'; end if;
  update public.conference_members set role = new_role where user_id = target;
  return public.get_conference_team();
end $$;
revoke all on function public.set_conference_member_role(text, text) from public, anon;
grant execute on function public.set_conference_member_role(text, text) to authenticated;

create function public.remove_conference_member(member_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid; owner uuid; caller text := public.conference_caller_role(); target public.conference_members;
begin
  perform public.conference_require_confirmed_user();
  if caller not in ('owner', 'admin') then raise exception 'Somente o responsável pode remover integrantes'; end if;
  select t.id, t.owner_id into tid, owner from public.conference_teams t
    join public.conference_members m on m.team_id = t.id where m.user_id = auth.uid() for update of t;
  select * into target from public.conference_members m
    where m.team_id = tid and m.email = lower(trim(member_email));
  if target.user_id is null or target.user_id = owner or target.user_id = auth.uid() then
    raise exception 'Integrante não encontrado';
  end if;
  if caller = 'admin' and target.role = 'admin' then
    raise exception 'Somente o responsável pode remover um administrador';
  end if;
  delete from public.conference_members where user_id = target.user_id;
  return public.get_conference_team();
end $$;
revoke all on function public.remove_conference_member(text) from public, anon;
grant execute on function public.remove_conference_member(text) to authenticated;

create function public.set_conference_settings(branch_codes text[], reason_codes text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid; em text; branches text[]; reasons text[];
begin
  perform public.conference_require_confirmed_user();
  if public.conference_caller_role() not in ('owner', 'admin') then
    raise exception 'Somente o responsável pode alterar a configuração';
  end if;
  select m.team_id, m.email into tid, em from public.conference_members m where m.user_id = auth.uid();
  select coalesce(array_agg(distinct upper(trim(v))), '{}') into branches from unnest(branch_codes) v where trim(v) <> '';
  select coalesce(array_agg(distinct upper(trim(v))), '{}') into reasons from unnest(reason_codes) v where trim(v) <> '';
  if cardinality(branches) not between 1 and 30 or cardinality(reasons) not between 1 and 30
    or exists(select 1 from unnest(branches || reasons) v where v !~ '^[0-9A-Z]{1,8}$') then
    raise exception 'CONFERENCE_INVALID';
  end if;
  insert into public.conference_team_settings as s (team_id, branches, reasons, updated_by)
    values (tid, branches, reasons, em)
    on conflict (team_id) do update set branches = excluded.branches, reasons = excluded.reasons,
      updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('branches', to_jsonb(branches), 'reasons', to_jsonb(reasons));
end $$;
revoke all on function public.set_conference_settings(text[], text[]) from public, anon;
grant execute on function public.set_conference_settings(text[], text[]) to authenticated;

-- Read-only members can look but not write. Same body as before plus the role check.
create or replace function public.save_team_conference_v2(base_data jsonb, next_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare oid uuid; settled text[];
begin
  if public.conference_caller_role() = 'leitura' then raise exception 'CONFERENCE_READ_ONLY'; end if;
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

-- Archiving rewrites the live row, so read-only members may not trigger it.
do $migration$
declare definition text;
  marker text := 'oid := public.conference_caller_owner();';
begin
  definition := pg_get_functiondef('public.archive_conference_manifests(integer)'::regprocedure);
  if position(marker in definition) = 0 then raise exception 'Unexpected archive RPC version'; end if;
  execute replace(definition, marker,
    'if public.conference_caller_role() = ''leitura'' then raise exception ''CONFERENCE_READ_ONLY''; end if; ' || marker);
end
$migration$;

-- Every write now goes through save_team_conference_v2.
revoke execute on function public.save_team_conference(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.save_conference(bigint, jsonb) from public, anon, authenticated;

-- Browser errors, so failures are seen without anyone reporting them. Kept 90 days.
create table public.conference_client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  message text not null,
  stack text,
  page text,
  agent text
);
create index conference_client_errors_recent on public.conference_client_errors (occurred_at desc);
create index conference_client_errors_user on public.conference_client_errors (user_id, occurred_at desc);
alter table public.conference_client_errors enable row level security;
revoke all on public.conference_client_errors from public, anon, authenticated;

create function public.report_client_error(message text, stack text default null, page text default null, agent text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or coalesce(trim(message), '') = '' then return false; end if;
  if (select count(*) from public.conference_client_errors e
      where e.user_id = uid and e.occurred_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  insert into public.conference_client_errors (user_id, message, stack, page, agent)
    values (uid, left(message, 1000), left(stack, 4000), left(page, 300), left(agent, 300));
  delete from public.conference_client_errors where occurred_at < now() - interval '90 days';
  return true;
end $$;
revoke all on function public.report_client_error(text, text, text, text) from public, anon;
grant execute on function public.report_client_error(text, text, text, text) to authenticated;

commit;
