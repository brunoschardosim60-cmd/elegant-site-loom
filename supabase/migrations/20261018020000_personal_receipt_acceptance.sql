-- Independent personal confirmations; one canonical team document and total.
-- All authors/times are assigned inside the existing authenticated team lock.
begin;
create or replace function public.conference_receipt_baseline(doc jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select case when doc ? 'receiptChecks' then doc->'receiptChecks'
    when doc->'received'='true'::jsonb and doc->>'receivedBy' is not null then
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id',doc->'receivedBy','received',true,'receivedAt',doc->'receivedAt','email',doc->'receivedByEmail','documentVersion',(doc->>'ctc')||'|'||(doc->>'nf')||'|'||(doc->>'volumes'))))
    else '[]'::jsonb end;
$$;
revoke all on function public.conference_receipt_baseline(jsonb) from public,anon,authenticated;

create or replace function public.conference_receipt_manifest(m jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare d jsonb; checks jsonb; first_receipt jsonb; docs jsonb='[]';
begin
  for d in select value from jsonb_array_elements(m->'documents') loop
    checks=public.conference_receipt_baseline(d);
    -- Unattributed pre-team confirmations remain a personal baseline for their
    -- original owner. Do not invent an actor or offer them as peer evidence.
    if not d ? 'receiptChecks' and d->'received'='true'::jsonb and d->>'receivedBy' is null and m->>'createdBy' is not null then
      checks=jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id',m->'createdBy','received',true,'legacy',true,'receivedAt',d->'receivedAt','documentVersion',(d->>'ctc')||'|'||(d->>'nf')||'|'||(d->>'volumes'))));
    end if;
    select value into first_receipt from jsonb_array_elements(checks) where value->'received'='true'::jsonb and (not value ? 'documentVersion' or value->>'documentVersion'=(d->>'ctc')||'|'||(d->>'nf')||'|'||(d->>'volumes')) order by value->>'receivedAt',value->>'id' limit 1;
    if first_receipt is not null then
      d=(d-'receivedAt'-'receivedBy'-'receivedByEmail')||jsonb_strip_nulls(jsonb_build_object('received',true,'receivedAt',first_receipt->'receivedAt','receivedBy',case when first_receipt->'legacy'='true'::jsonb then null else first_receipt->'id' end,'receivedByEmail',first_receipt->'email'));
    elsif jsonb_array_length(checks)>0 or d->'received'<>'true'::jsonb or d->>'receivedBy' is not null then
      d=(d-'receivedAt'-'receivedBy'-'receivedByEmail')||jsonb_build_object('received',false);
    end if;
    docs=docs||jsonb_build_array(jsonb_set(d,'{receiptChecks}',checks));
  end loop;
  return jsonb_set(m,'{documents}',docs);
end $$;
revoke all on function public.conference_receipt_manifest(jsonb) from public,anon,authenticated;

create or replace function public.conference_prepare_receipts(base_payload jsonb,next_payload jsonb,stored_payload jsonb,team_key uuid,actor uuid,actor_email text,stamp timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare m jsonb; d jsonb; bm jsonb; bd jsonb; om jsonb; od jsonb; base_own jsonb; raw_base_own jsonb; wanted jsonb; own jsonb; source jsonb;
  checks jsonb; docs jsonb; manifests jsonb='[]'; base_manifests jsonb='[]'; base_docs jsonb; changed boolean; desired boolean; event text; doc_version text;
begin
  for m in select value from jsonb_array_elements(next_payload->'manifests') loop
    select value into bm from jsonb_array_elements(base_payload->'manifests') where value->>'id'=m->>'id' or coalesce(m->'previousIds','[]') ? (value->>'id');
    select value into om from jsonb_array_elements(stored_payload->'manifests') where value->>'id'=m->>'id' or coalesce(m->'previousIds','[]') ? (value->>'id');
    docs='[]'; base_docs='[]';
    for d in select value from jsonb_array_elements(m->'documents') loop
      select value into bd from jsonb_array_elements(coalesce(bm->'documents','[]')) where value->>'id'=d->>'id';
      select value into od from jsonb_array_elements(coalesce(om->'documents','[]')) where value->>'id'=d->>'id';
      checks=public.conference_receipt_baseline(od);
      select value into own from jsonb_array_elements(checks) where value->>'id'=actor::text;
      select value into base_own from jsonb_array_elements(public.conference_receipt_baseline(bd)) where value->>'id'=actor::text;
      select value into wanted from jsonb_array_elements(coalesce(d->'receiptChecks','[]')) where value->>'id'=actor::text;
      raw_base_own=base_own;
      doc_version=(d->>'ctc')||'|'||(d->>'nf')||'|'||(d->>'volumes');
      if own ? 'documentVersion' and own->>'documentVersion'<>doc_version then own=jsonb_set(own,'{received}','false'); end if;
      if base_own ? 'documentVersion' and base_own->>'documentVersion'<>(bd->>'ctc')||'|'||(bd->>'nf')||'|'||(bd->>'volumes') then base_own=jsonb_set(base_own,'{received}','false'); end if;
      -- Caller may only request their own state. Foreign receipt fields are
      -- ignored and restored from committed data; they are never client-authored.
      changed=(coalesce(wanted->'received','false') is distinct from coalesce(raw_base_own->'received','false'))
        or coalesce((wanted->'received'='true'::jsonb and wanted->>'documentVersion' is distinct from raw_base_own->>'documentVersion'),false);
      desired=coalesce(wanted->'received','false')='true'::jsonb;
      if not changed and d->'received' is distinct from coalesce(bd->'received','false') then
        changed=true; desired=d->'received'='true'::jsonb; wanted=null;
      end if;
      if changed then
        if coalesce(own->'received','false') is distinct from coalesce(base_own->'received','false')
          and coalesce(own->'received','false') is distinct from to_jsonb(desired) then raise exception 'CONFERENCE_CONFLICT'; end if;
        if coalesce(own->'received','false') is distinct from to_jsonb(desired) then
          if desired then
            if od is not null and bd is not null
              and ((od->>'ctc')||'|'||(od->>'nf')||'|'||(od->>'volumes')) is distinct from ((bd->>'ctc')||'|'||(bd->>'nf')||'|'||(bd->>'volumes'))
              and doc_version is distinct from ((od->>'ctc')||'|'||(od->>'nf')||'|'||(od->>'volumes')) then raise exception 'CONFERENCE_CONFLICT'; end if;
            own=jsonb_build_object('id',actor,'received',true,'receivedAt',stamp,'email',actor_email,'documentVersion',doc_version);
            if wanted->>'acceptedFrom' is not null then
              select value into source from jsonb_array_elements(checks) where value->>'id'=wanted->>'acceptedFrom' and value->'received'='true'::jsonb and coalesce(value->'legacy','false')<>'true'::jsonb and (not value ? 'documentVersion' or value->>'documentVersion'=doc_version);
              if source is null or source->>'id'=actor::text or source->>'receivedAt' is distinct from wanted->>'sourceReceivedAt' then raise exception 'CONFERENCE_CONFLICT'; end if;
              own=own||jsonb_build_object('acceptedFrom',source->'id','sourceReceivedAt',source->'receivedAt');
            end if;
          else own=jsonb_build_object('id',actor,'received',false,'documentVersion',doc_version); end if;
          select coalesce(jsonb_agg(value order by value->>'id'),'[]') into checks from jsonb_array_elements(checks) where value->>'id'<>actor::text;
          checks=checks||jsonb_build_array(own);
          event=case when not desired then 'ctc_personal_reopened' when own ? 'acceptedFrom' then 'ctc_personal_accepted' else 'ctc_personal_received' end;
          insert into public.conference_audit(team_id,actor_id,actor_email,manifest_id,action,details)
          values(team_key,actor,actor_email,m->>'id',event,jsonb_build_object('ctc',d->>'ctc','before',base_own,'after',own));
        end if;
      end if;
      if jsonb_array_length(checks)>1000 then raise exception 'CONFERENCE_INVALID'; end if;
      d=jsonb_set(d,'{receiptChecks}',checks);
      if od is not null then
        -- Derived team fields must not conflict with another member's receipt.
        d=(d-'receivedAt'-'receivedBy'-'receivedByEmail')||jsonb_strip_nulls(jsonb_build_object('received',od->'received','receivedAt',od->'receivedAt','receivedBy',od->'receivedBy','receivedByEmail',od->'receivedByEmail'));
      end if;
      docs=docs||jsonb_build_array(d);
    end loop;
    manifests=manifests||jsonb_build_array(jsonb_set(m,'{documents}',docs));
  end loop;
  -- Rebase ONLY server-controlled receipt fields. Other fields still use the
  -- normal three-way merge and reject stale conflicting edits/deletions.
  for bm in select value from jsonb_array_elements(base_payload->'manifests') loop
    select value into om from jsonb_array_elements(stored_payload->'manifests') where value->>'id'=bm->>'id';
    base_docs='[]';
    for bd in select value from jsonb_array_elements(bm->'documents') loop
      select value into od from jsonb_array_elements(coalesce(om->'documents','[]')) where value->>'id'=bd->>'id';
      if od is not null then
        bd=(bd-'receivedAt'-'receivedBy'-'receivedByEmail')||jsonb_strip_nulls(jsonb_build_object('received',od->'received','receivedAt',od->'receivedAt','receivedBy',od->'receivedBy','receivedByEmail',od->'receivedByEmail','receiptChecks',public.conference_receipt_baseline(od)));
      end if;
      base_docs=base_docs||jsonb_build_array(bd);
    end loop;
    base_manifests=base_manifests||jsonb_build_array(jsonb_set(bm,'{documents}',base_docs));
  end loop;
  return jsonb_build_object('base',jsonb_set(base_payload,'{manifests}',base_manifests),'next',jsonb_set(next_payload,'{manifests}',manifests));
end $$;
revoke all on function public.conference_prepare_receipts(jsonb,jsonb,jsonb,uuid,uuid,text,timestamptz) from public,anon,authenticated;

create or replace function public.conference_strip_personal_receipts(payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare m jsonb; manifests jsonb='[]';
begin
  if jsonb_typeof(payload->'manifests') is distinct from 'array' then return payload; end if;
  for m in select value from jsonb_array_elements(payload->'manifests') loop
    if jsonb_typeof(m->'documents')='array' then
      m=jsonb_set(m,'{documents}',coalesce((select jsonb_agg(value-'receiptChecks' order by ordinal) from jsonb_array_elements(m->'documents') with ordinality entries(value,ordinal)),'[]'));
    end if;
    manifests=manifests||jsonb_build_array(m);
  end loop;
  return jsonb_set(payload,'{manifests}',manifests);
end $$;
revoke all on function public.conference_strip_personal_receipts(jsonb) from public,anon,authenticated;

do $migration$
declare definition text; marker text;
begin
  definition=pg_get_functiondef('public.conference_validate_input(jsonb)'::regprocedure);
  if position('receiptChecks' in definition)=0 then
    definition=replace(definition,'''nfOccurrences'',''deliveryDates''','''nfOccurrences'',''deliveryDates'',''receiptChecks''');
    definition=replace(definition,'''nfOccurrences'',''deliveryDates'']','''nfOccurrences'',''deliveryDates'',''receiptChecks'']');
    marker='for d in select value from jsonb_array_elements(m->''documents'') loop';
    if position(marker in definition)=0 then raise exception 'Unexpected receipt validator version'; end if;
    definition=replace(definition,marker,marker||$guard$
      if d ? 'receiptChecks' then
        if jsonb_typeof(d->'receiptChecks')<>'array' then raise exception 'CONFERENCE_INVALID'; end if;
        if jsonb_array_length(d->'receiptChecks')>1000 then raise exception 'CONFERENCE_INVALID'; end if;
        if exists(select 1 from jsonb_array_elements(d->'receiptChecks') c where jsonb_typeof(c)<>'object' or c-ARRAY['id','received','receivedAt','email','acceptedFrom','sourceReceivedAt','documentVersion','legacy']<>'{}'
          or jsonb_typeof(c->'id') is distinct from 'string' or c->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or jsonb_typeof(c->'received') is distinct from 'boolean'
          or (c ? 'legacy' and jsonb_typeof(c->'legacy')<>'boolean')
          or exists(select 1 from jsonb_each(c) where key not in ('id','received','legacy') and jsonb_typeof(value)<>'string'))
          or exists(select 1 from jsonb_array_elements(d->'receiptChecks') c group by c->>'id' having count(*)>1) then raise exception 'CONFERENCE_INVALID'; end if;
      end if;
    $guard$);
    execute definition;
  end if;
  definition=pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('conference_prepare_receipts' in definition)=0 then
    marker='merged=public.conference_merge(base_data,next_data,old_data);';
    if position(marker in definition)=0 then raise exception 'Unexpected receipt writer version'; end if;
    definition=replace(definition,marker,$prepare$
      old_data=jsonb_set(old_data,'{manifests}',coalesce((select jsonb_agg(public.conference_receipt_manifest(value) order by ordinal) from jsonb_array_elements(old_data->'manifests') with ordinality entries(value,ordinal)),'[]'));
      merged=public.conference_prepare_receipts(base_data,next_data,old_data,tid,auth.uid(),em,stamp);
      base_data=merged->'base'; next_data=merged->'next';
    $prepare$||marker||$aggregate$
      merged=jsonb_set(merged,'{manifests}',coalesce((select jsonb_agg(public.conference_receipt_manifest(value) order by ordinal) from jsonb_array_elements(merged->'manifests') with ordinality entries(value,ordinal)),'[]'));
      -- A personal confirmation/acceptance cannot target an older rerouted CTC.
      if exists(select 1 from jsonb_array_elements(merged->'manifests') nm cross join lateral jsonb_array_elements(nm->'documents') nd
        cross join lateral jsonb_array_elements(coalesce(nd->'receiptChecks','[]')) c
        where c->>'id'=auth.uid()::text and c->'received'='true'::jsonb
          and not exists(select 1 from jsonb_array_elements(old_data->'manifests') om cross join lateral jsonb_array_elements(om->'documents') od cross join lateral jsonb_array_elements(public.conference_receipt_baseline(od)) oc where od->>'id'=nd->>'id' and oc->>'id'=c->>'id' and oc->'received'='true'::jsonb)
          and exists(select 1 from jsonb_array_elements(merged->'manifests') rm cross join lateral jsonb_array_elements(rm->'documents') rd where rd->>'ctc'=nd->>'ctc' and rm->>'issueDate'>nm->>'issueDate')) then raise exception 'CONFERENCE_CONFLICT'; end if;
    $aggregate$);
    marker='pres=pres||jsonb_build_array(m);';
    definition=replace(definition,marker,'m=public.conference_receipt_manifest(m);'||chr(10)||marker);
    execute definition;
  end if;
  definition=pg_get_functiondef('public.get_conference_team(boolean)'::regprocedure);
  if position('''personalReceipts''' in definition)=0 then
    definition=replace(definition,'''sharedDemands'',true','''personalReceipts'',true,''sharedDemands'',true');
    marker='return jsonb_build_object(''teamId'',tid';
    -- Earlier capabilities precede teamId in the current reader.
    marker='return jsonb_build_object(''personalReceipts'',true';
    if position(marker in definition)=0 then raise exception 'Unexpected personal receipt reader version'; end if;
    definition=replace(definition,marker,$backfill$
      if exists(select 1 from jsonb_array_elements(payload->'manifests') m cross join lateral jsonb_array_elements(m->'documents') d where not d ? 'receiptChecks') then
        payload=jsonb_set(payload,'{manifests}',coalesce((select jsonb_agg(public.conference_receipt_manifest(value) order by ordinal) from jsonb_array_elements(payload->'manifests') with ordinality entries(value,ordinal)),'[]'));
        update public.conference_states receipt_state set data=payload,revision=receipt_state.revision+1,updated_at=clock_timestamp() where receipt_state.user_id=own.owner_id returning receipt_state.revision into revision;
      end if;
    $backfill$||marker);
    execute definition;
  end if;
  definition=pg_get_functiondef('public.save_conference(bigint,jsonb)'::regprocedure);
  if position('conference_strip_personal_receipts' in definition)=0 then
    marker='next_data=public.conference_strip_action_actors(next_data);';
    if position(marker in definition)=0 then raise exception 'Unexpected legacy receipt writer'; end if;
    execute replace(definition,marker,marker||chr(10)||'next_data=public.conference_strip_personal_receipts(next_data);');
  end if;
end $migration$;

-- Preserve historical confirmations with their existing authenticated authors.
update public.conference_states s set data=jsonb_set(s.data,'{manifests}',(
  select coalesce(jsonb_agg(public.conference_receipt_manifest(value) order by ordinal),'[]')
  from jsonb_array_elements(s.data->'manifests') with ordinality entries(value,ordinal)
)),revision=s.revision+1,updated_at=clock_timestamp()
where exists(select 1 from public.conference_teams t where t.owner_id=s.user_id)
  and exists(select 1 from jsonb_array_elements(s.data->'manifests') m cross join lateral jsonb_array_elements(m->'documents') d where not d ? 'receiptChecks');
commit;
