-- Per-team deadline: how many days after the manifest date a pending CTC
-- counts as late (filters, badges, indicators and map). Default 2, as before.
begin;

alter table public.conference_team_settings
  add column if not exists late_days integer not null default 2 check (late_days between 1 and 30);

-- The team loader reports it with the other import settings.
do $migration$
declare definition text;
  stored text := $s$jsonb_build_object('branches', to_jsonb(s.branches), 'reasons', to_jsonb(s.reasons))$s$;
  fallback text := $s$jsonb_build_object('branches', '["06"]'::jsonb, 'reasons', '["DIS"]'::jsonb)$s$;
begin
  definition := pg_get_functiondef('public.get_conference_team(boolean)'::regprocedure);
  if position(stored in definition) = 0 or position(fallback in definition) = 0 then
    raise exception 'Unexpected get_conference_team version; review the settings block before applying';
  end if;
  definition := replace(definition, stored,
    $s$jsonb_build_object('branches', to_jsonb(s.branches), 'reasons', to_jsonb(s.reasons), 'lateDays', s.late_days)$s$);
  definition := replace(definition, fallback,
    $s$jsonb_build_object('branches', '["06"]'::jsonb, 'reasons', '["DIS"]'::jsonb, 'lateDays', 2)$s$);
  execute definition;
end
$migration$;

create function public.set_conference_late_days(days integer) returns integer
language plpgsql security definer set search_path='' as $$
declare tid uuid; em text;
begin
  perform public.conference_require_confirmed_user();
  if public.conference_caller_role() not in ('owner', 'admin') then
    raise exception 'Somente o responsável pode alterar a configuração';
  end if;
  if days is null or days not between 1 and 30 then raise exception 'CONFERENCE_INVALID'; end if;
  select m.team_id, m.email into tid, em from public.conference_members m where m.user_id = auth.uid();
  insert into public.conference_team_settings as s (team_id, late_days, updated_by)
    values (tid, days, em)
    on conflict (team_id) do update set late_days = excluded.late_days,
      updated_at = now(), updated_by = excluded.updated_by;
  return days;
end $$;
revoke all on function public.set_conference_late_days(integer) from public, anon;
grant execute on function public.set_conference_late_days(integer) to authenticated;

commit;
