-- Optional printed issuance time and calendar delivery forecasts.
-- These are informational: never infer an agenda or delay from an issuance cutoff.
do $migration$
declare definition text;
  marker text := 'merged=public.conference_merge(base_data,next_data,old_data);';
  guard text := $guard$
  if exists(select 1 from jsonb_array_elements(merged->'manifests') route_meta
    where route_meta ? 'issueTime' and (jsonb_typeof(route_meta->'issueTime') is distinct from 'string'
      or route_meta->>'issueTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') route_meta
    cross join lateral jsonb_array_elements(route_meta->'documents') doc_meta
    where doc_meta ? 'deliveryDates' and case when jsonb_typeof(doc_meta->'deliveryDates')='array'
      then jsonb_array_length(doc_meta->'deliveryDates')>300 else true end) then raise exception 'CONFERENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(merged->'manifests') route_meta
    cross join lateral jsonb_array_elements(route_meta->'documents') doc_meta
    cross join lateral jsonb_array_elements(coalesce(doc_meta->'deliveryDates','[]')) delivery_day
    where jsonb_typeof(delivery_day) is distinct from 'string' or delivery_day #>> '{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'CONFERENCE_INVALID'; end if;
  perform (delivery_day #>> '{}')::date from jsonb_array_elements(merged->'manifests') route_meta
    cross join lateral jsonb_array_elements(route_meta->'documents') doc_meta
    cross join lateral jsonb_array_elements(coalesce(doc_meta->'deliveryDates','[]')) delivery_day;
  $guard$;
begin
  definition := pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('deliveryDates' in definition)>0 then return; end if;
  if position(marker in definition)=0 then raise exception 'Unexpected conference RPC version; review schedule metadata validation'; end if;
  execute replace(definition,marker,marker || guard);
end
$migration$;
