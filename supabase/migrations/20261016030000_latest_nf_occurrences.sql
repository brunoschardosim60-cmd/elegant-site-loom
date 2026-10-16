-- Protect occurrence chronology in the authenticated transaction as well as the UI.
create or replace function public.conference_occurrence_reference(value text, with_time boolean)
returns text language plpgsql immutable set search_path='' as $$
begin
  if value is null then return null; end if;
  if with_time then
    if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
      or to_char(value::timestamp,'YYYY-MM-DD"T"HH24:MI:SS')<>value then return null; end if;
  elsif value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(value::date,'YYYY-MM-DD')<>value then return null;
  end if;
  return value;
exception when others then return null;
end $$;
revoke all on function public.conference_occurrence_reference(text,boolean) from public,anon,authenticated;

create or replace function public.conference_occurrence_is_newer(previous jsonb, incoming jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare before_date text; after_date text; before_report text; after_report text;
begin
  if previous is null then return true; end if;
  before_date=public.conference_occurrence_reference(previous->>'occurredOn',false);
  after_date=public.conference_occurrence_reference(incoming->>'occurredOn',false);
  before_report=public.conference_occurrence_reference(previous->>'reportGeneratedAt',true);
  after_report=public.conference_occurrence_reference(incoming->>'reportGeneratedAt',true);
  if before_date is not null and after_date is not null and before_date<>after_date then return after_date>before_date; end if;
  if before_report is not null and after_report is not null and before_report<>after_report then return after_report>before_report; end if;
  if previous->>'nf'=incoming->>'nf' and previous->>'code'=incoming->>'code' and previous->>'description'=incoming->>'description' then
    return (before_date is null and after_date is not null) or (before_report is null and after_report is not null);
  end if;
  -- The first dated report establishes the reference for legacy undated values.
  return before_date is null and before_report is null and (after_date is not null or after_report is not null);
end $$;
revoke all on function public.conference_occurrence_is_newer(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.conference_latest_nf_occurrences(original jsonb, candidate jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare doc jsonb; prior jsonb; incoming jsonb; previous jsonb; selected jsonb;
  invoices jsonb; result_docs jsonb='[]'; invoice text;
begin
  for doc in select value from jsonb_array_elements(candidate->'documents') loop
    select value into prior from jsonb_array_elements(coalesce(original->'documents','[]'))
      where value->>'id'=doc->>'id' and value->>'ctc'=doc->>'ctc';
    if doc ? 'nfOccurrences' or prior ? 'nfOccurrences' then
      if doc ? 'nfOccurrences' and (jsonb_typeof(doc->'nfOccurrences') is distinct from 'array' or jsonb_array_length(doc->'nfOccurrences')>3000) then raise exception 'CONFERENCE_INVALID'; end if;
      for incoming in select value from jsonb_array_elements(coalesce(doc->'nfOccurrences','[]')) loop
        if jsonb_typeof(incoming->'nf') is distinct from 'string' or incoming->>'nf' !~ '^[0-9]{1,9}-[0-9]{1,3}$'
          or jsonb_typeof(incoming->'code') is distinct from 'string' or length(incoming->>'code')>32
          or jsonb_typeof(incoming->'description') is distinct from 'string' or length(incoming->>'description')>1000
          or coalesce(incoming->>'code','')||coalesce(incoming->>'description','')=''
          or (incoming ? 'occurredOn' and public.conference_occurrence_reference(incoming->>'occurredOn',false) is null)
          or (incoming ? 'reportGeneratedAt' and public.conference_occurrence_reference(incoming->>'reportGeneratedAt',true) is null)
          then raise exception 'CONFERENCE_INVALID'; end if;
      end loop;
      if (select count(*)<>count(distinct value->>'nf') from jsonb_array_elements(coalesce(doc->'nfOccurrences','[]'))) then raise exception 'CONFERENCE_INVALID'; end if;
      invoices='[]';
      for invoice in select distinct trim(value) from regexp_split_to_table(doc->>'nf','[,;]') value order by trim(value) loop
        select value into incoming from jsonb_array_elements(coalesce(doc->'nfOccurrences','[]')) where value->>'nf'=invoice limit 1;
        select value into previous from jsonb_array_elements(coalesce(prior->'nfOccurrences','[]')) where value->>'nf'=invoice limit 1;
        selected=case when incoming is not null and public.conference_occurrence_is_newer(previous,incoming) then incoming else previous end;
        if selected=incoming and previous->>'code'=incoming->>'code' and previous->>'description'=incoming->>'description' then selected=previous||incoming; end if;
        if selected is not null then invoices=invoices||jsonb_build_array(selected); end if;
      end loop;
      -- Keep the existing order for no-op imports; canonical sorting only applies
      -- when the set or contents actually change.
      if (select coalesce(jsonb_agg(value order by value->>'nf'),'[]') from jsonb_array_elements(coalesce(prior->'nfOccurrences','[]')))=invoices then
        invoices=prior->'nfOccurrences';
      end if;
      doc=doc-'nfOccurrences';
      if jsonb_array_length(coalesce(invoices,'[]'))>0 then doc=doc||jsonb_build_object('nfOccurrences',invoices); end if;
    end if;
    result_docs=result_docs||jsonb_build_array(doc);
  end loop;
  return jsonb_set(candidate,'{documents}',result_docs);
end $$;
revoke all on function public.conference_latest_nf_occurrences(jsonb,jsonb) from public,anon,authenticated;

do $migration$
declare definition text; marker text='m=public.conference_manifest_actions(tid,m,old_m,auth.uid(),em,stamp);';
begin
  definition=pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('conference_latest_nf_occurrences' in definition)=0 then
    if position(marker in definition)=0 then raise exception 'Unexpected conference action version'; end if;
    execute replace(definition,marker,'m=public.conference_latest_nf_occurrences(old_m,m);'||chr(10)||marker);
  end if;
end
$migration$;
