-- The same CTC can return to a different manifested route on a different day.
-- Keep both attempts, receipt timestamps and audit. Same-day/undated
-- duplicates remain forbidden. No rows, membership, grants or RLS are changed.
create or replace function public.conference_has_ctc_conflicts(snapshot jsonb)
returns boolean language sql immutable set search_path='' as $fn$
  select exists (
    select 1 from jsonb_array_elements(snapshot->'manifests') mi
    cross join lateral jsonb_array_elements(mi->'documents') di
    group by di->>'ctc'
    having count(*) > 1 and count(distinct case
      when mi->>'id' ~ '^(DI[0-9]{8,12}|[0-9]{8,12})$' and mi->>'issueDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then mi->>'issueDate' end) < count(*)
  );
$fn$;

do $migration$
declare definition text;
  original text := 'exists(select 1 from jsonb_array_elements(merged->''manifests'') mi cross join lateral jsonb_array_elements(mi->''documents'') di group by di->>''ctc'' having count(*)>1)';
  marker text := 'merged=public.conference_merge(base_data,next_data,old_data);';
  guard text := $guard$
  -- A stale browser must not receive the previous route after a newer route
  -- was committed by a colleague. Serialize this check with the existing lock.
  if exists (
    select 1 from jsonb_array_elements(next_data->'manifests') nm
    cross join lateral jsonb_array_elements(nm->'documents') nd
    where nd->'received'='true'::jsonb
      and not exists(select 1 from jsonb_array_elements(base_data->'manifests') bm
        cross join lateral jsonb_array_elements(bm->'documents') bd
        where bm->>'id'=nm->>'id' and bd->>'id'=nd->>'id' and bd->'received'='true'::jsonb)
      and nm->>'id' ~ '^(DI[0-9]{8,12}|[0-9]{8,12})$'
      and exists(select 1 from jsonb_array_elements(merged->'manifests') rm
        cross join lateral jsonb_array_elements(rm->'documents') rd
        where rd->>'ctc'=nd->>'ctc' and rm->>'id' ~ '^(DI[0-9]{8,12}|[0-9]{8,12})$'
          and rm->>'issueDate' > nm->>'issueDate')
  ) then raise exception 'CONFERENCE_CONFLICT'; end if;
  $guard$;
begin
  definition := pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('public.conference_has_ctc_conflicts(merged)' in definition)>0 then
    execute replace(definition, '~ ''^[0-9]{8,12}$''', '~ ''^(DI[0-9]{8,12}|[0-9]{8,12})$''');
    return;
  end if;
  if position(original in definition)=0 or position(marker in definition)=0 then
    raise exception 'Unexpected conference RPC version; review route validation before applying';
  end if;
  definition := replace(definition, original, 'public.conference_has_ctc_conflicts(merged)');
  execute replace(definition, marker, marker || guard);
end
$migration$;
