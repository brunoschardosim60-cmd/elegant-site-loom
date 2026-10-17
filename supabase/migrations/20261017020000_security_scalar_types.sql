-- A confirmed account must not poison the canonical snapshot with values
-- accepted by ->> coercion but rejected by the browser's persisted schema.
begin;
do $migration$
declare definition text; marker text;
begin
  definition=pg_get_functiondef('public.conference_validate_input(jsonb)'::regprocedure);
  if position('Strict scalar types' in definition)=0 then
    marker='-- Every non-array manifest field is scalar.';
    if position(marker in definition)=0 then raise exception 'Unexpected input validator version'; end if;
    definition=replace(definition,marker,$types$
      -- Strict scalar types: do not coerce booleans/numbers into identifiers.
      if exists(select 1 from unnest(ARRAY['id','driver','plate','date']) field where jsonb_typeof(m->field) is distinct from 'string')
        or exists(select 1 from jsonb_each(m) where key in ('issueDate','issueTime','finishedAt') and jsonb_typeof(value)<>'string')
        or (m ? 'issueDate' and public.conference_occurrence_reference(m->>'issueDate',false) is null)
        or (m ? 'issueTime' and m->>'issueTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'CONFERENCE_INVALID'; end if;
    $types$||marker);
    marker='if exists(select 1 from jsonb_each(d) where key in (''nfOccurrences'',''deliveryDates'')';
    if position(marker in definition)=0 then raise exception 'Unexpected document validator version'; end if;
    definition=replace(definition,marker,$types$
      if exists(select 1 from unnest(ARRAY['id','ctc','nf']) field where jsonb_typeof(d->field) is distinct from 'string')
        or exists(select 1 from jsonb_each(d) where key in ('client','recipient','receivedAt') and jsonb_typeof(value)<>'string')
        or d->>'ctc' !~ '^[0-9]{10}$'
        or jsonb_typeof(d->'received') is distinct from 'boolean'
        or jsonb_typeof(d->'volumes') is distinct from 'number' then raise exception 'CONFERENCE_INVALID'; end if;
      if (d->>'volumes')::numeric not between 1 and 9007199254740991 or trunc((d->>'volumes')::numeric)<>(d->>'volumes')::numeric then raise exception 'CONFERENCE_INVALID'; end if;
    $types$||marker);
    -- Validate event text and UTC timestamps as well as its shallow structure.
    marker='for event in select value from jsonb_array_elements(payload->''activity''||payload->''issues'') loop';
    if position(marker in definition)=0 then raise exception 'Unexpected event validator version'; end if;
    definition=replace(definition,marker,marker||$types$
      if exists(select 1 from unnest(ARRAY['title','description','time']) field where jsonb_typeof(event->field) is distinct from 'string')
        or (event ? 'warning' and jsonb_typeof(event->'warning') is distinct from 'boolean')
        or (event ? 'at' and (jsonb_typeof(event->'at') is distinct from 'string' or event->>'at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?Z$')) then raise exception 'CONFERENCE_INVALID'; end if;
      if event ? 'at' then
        begin perform (event->>'at')::timestamptz; exception when others then raise exception 'CONFERENCE_INVALID'; end;
      end if;
      if jsonb_typeof(event->'id')='number' and (event->>'id')::numeric not between -9007199254740991 and 9007199254740991 then raise exception 'CONFERENCE_INVALID'; end if;
      if jsonb_typeof(event->'id') not in ('number','string') or not event ? 'id' then raise exception 'CONFERENCE_INVALID'; end if;
      if jsonb_typeof(event->'id')='string' and event->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'CONFERENCE_INVALID'; end if;
    $types$);
    marker='    end loop;';
    if position(marker in definition)=0 then raise exception 'Unexpected document loop version'; end if;
    definition=replace(definition,marker,$types$
      -- Legacy writers must meet the same optional metadata schema as shared writers.
      if d ? 'deliveryDates' and jsonb_array_length(d->'deliveryDates')>300 then raise exception 'CONFERENCE_INVALID'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(d->'deliveryDates','[]')) where public.conference_occurrence_reference(value #>> '{}',false) is null or value #>> '{}'<'1000-01-01') then raise exception 'CONFERENCE_INVALID'; end if;
      if d ? 'nfOccurrences' and jsonb_array_length(d->'nfOccurrences')>3000 then raise exception 'CONFERENCE_INVALID'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(d->'nfOccurrences','[]')) occurrence
        where jsonb_typeof(occurrence->'nf') is distinct from 'string' or occurrence->>'nf' !~ '^[0-9]{1,9}-[0-9]{1,3}$'
          or jsonb_typeof(occurrence->'code') is distinct from 'string' or length(occurrence->>'code')>32
          or jsonb_typeof(occurrence->'description') is distinct from 'string' or length(occurrence->>'description')>1000
          or coalesce(occurrence->>'code','')||coalesce(occurrence->>'description','')=''
          or (occurrence ? 'occurredOn' and (public.conference_occurrence_reference(occurrence->>'occurredOn',false) is null or occurrence->>'occurredOn'<'1000-01-01'))
          or (occurrence ? 'reportGeneratedAt' and (public.conference_occurrence_reference(occurrence->>'reportGeneratedAt',true) is null or occurrence->>'reportGeneratedAt'<'1000-01-01T00:00:00')))
        then raise exception 'CONFERENCE_INVALID'; end if;
    $types$||marker);
    execute definition;
  end if;
end
$migration$;
commit;
