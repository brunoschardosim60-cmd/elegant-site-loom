-- Cargo details imported from the Luft 108 export: merchandise value and
-- weight per CTC (summed over its NFs), cargo nature and delivery city, and the
-- checker who loaded the manifest. Informational only: no rule depends on them.
-- The input validator accepts a closed list of keys; this extends that list.
do $migration$
declare definition text;
  doc_keys text := '''deliveryDates'',''receiptChecks'']<>''{}''';
  manifest_keys text := '''finishedAt'',''demandUserIds'']<>''{}''';
  volume_check text := 'if (d->>''volumes'')::numeric not between 1 and 9007199254740991 or trunc((d->>''volumes'')::numeric)<>(d->>''volumes'')::numeric then raise exception ''CONFERENCE_INVALID''; end if;';
  cargo_check text := $check$
      -- Cargo details: whole cents and grams, short texts.
      if exists(select 1 from jsonb_each(d) where key in ('cargoValueCents','weightGrams')
          and (jsonb_typeof(value)<>'number' or (value #>> '{}')::numeric not between 0 and 1000000000000000
            or trunc((value #>> '{}')::numeric)<>(value #>> '{}')::numeric))
        or exists(select 1 from jsonb_each(d) where key in ('nature','city')
          and (jsonb_typeof(value)<>'string' or length(value #>> '{}')>120)) then raise exception 'CONFERENCE_INVALID'; end if;$check$;
  checker_check text := $check$
      if m ? 'checker' and (jsonb_typeof(m->'checker')<>'string' or length(m->>'checker')>120) then raise exception 'CONFERENCE_INVALID'; end if;$check$;
  manifest_marker text := '-- Every non-array manifest field is scalar.';
begin
  definition := pg_get_functiondef('public.conference_validate_input(jsonb)'::regprocedure);
  if position('cargoValueCents' in definition) > 0 then return; end if;
  if position(doc_keys in definition) = 0 or position(manifest_keys in definition) = 0
    or position(volume_check in definition) = 0 or position(manifest_marker in definition) = 0 then
    raise exception 'Unexpected input validator version; review the key lists before applying';
  end if;
  definition := replace(definition, doc_keys,
    '''deliveryDates'',''receiptChecks'',''cargoValueCents'',''weightGrams'',''nature'',''city'']<>''{}''');
  definition := replace(definition, manifest_keys,
    '''finishedAt'',''demandUserIds'',''checker'']<>''{}''');
  definition := replace(definition, volume_check, volume_check || cargo_check);
  definition := replace(definition, manifest_marker, checker_check || E'\n    ' || manifest_marker);
  execute definition;
end
$migration$;
