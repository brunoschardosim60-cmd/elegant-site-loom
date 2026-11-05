-- Indicadores compare periods that reach past the live list: finished
-- manifests leave it after 30 days and live on in conference_archive. This
-- lists the caller's team's archived manifests by manifest date, read-only.
begin;

create index if not exists conference_archive_issue on public.conference_archive (owner_id, issue_date);

create function public.list_archived_conference_manifests(from_date date, to_date date)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare oid uuid; found jsonb;
begin
  if from_date is null or to_date is null or to_date < from_date or to_date - from_date > 400 then
    raise exception 'CONFERENCE_INVALID';
  end if;
  oid := public.conference_caller_owner();
  select coalesce(jsonb_agg(a.data order by a.issue_date, a.manifest_id), '[]')
    into found
  from (select data, issue_date, manifest_id from public.conference_archive
    where owner_id = oid and issue_date between from_date and to_date
    order by issue_date, manifest_id limit 5000) a;
  return found;
end $$;
revoke all on function public.list_archived_conference_manifests(date, date) from public, anon;
grant execute on function public.list_archived_conference_manifests(date, date) to authenticated;

commit;
