-- Run after all migrations. Fixtures and membership are rolled back.
-- These UUIDs/emails belong only to this isolated test transaction.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','confere-owner@example.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','confere-member@example.invalid',now()),
 ('33333333-3333-4333-8333-333333333333','confere-outsider@example.invalid',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.save_conference(0,'{"manifests":[],"activity":[],"issues":[]}');
do $$ begin
  if (select count(*) from public.conference_states)<>1 then raise exception 'Owner read failed'; end if;
  begin
    perform public.save_conference(0,'{}'); raise exception 'Stale revision accepted';
  exception when others then if sqlerrm<>'CONFERENCE_CONFLICT' then raise; end if; end;
end $$;
select public.get_conference_team(false);
select public.invite_conference_member('confere-member@example.invalid');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  if (select count(*) from public.conference_states)<>0 then raise exception 'Cross-account read'; end if;
  begin
    update public.conference_states set data='{}'; raise exception 'Direct write allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_conference_audit(); raise exception 'Outsider audit access';
  exception when others then if sqlerrm<>'Equipe não autorizada' then raise; end if; end;
  begin
    perform public.save_team_conference('{}','{}'); raise exception 'Outsider save allowed';
  exception when others then if sqlerrm<>'Equipe não autorizada' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select public.get_conference_team(true);
select public.save_team_conference('{"manifests":[],"activity":[],"issues":[]}',
 '{"manifests":[{"id":"DI00123456789","driver":"Fixture","plate":"ABC1234","date":"2026-10-13","documents":[{"id":"fixture-doc","ctc":"0000000001","nf":"123-1","volumes":1,"received":false}]}],"activity":[],"issues":[]}');
do $$ begin
  if public.conference_reader_owner()<>'confere-owner@example.invalid' then raise exception 'Wrong team owner'; end if;
  begin
    perform public.save_conference(1,'{}'); raise exception 'Legacy shared write allowed';
  exception when others then if sqlerrm<>'CONFERENCE_TEAM_RELOAD' then raise; end if; end;
  begin
    update public.conference_audit set actor_email='forged'; raise exception 'Audit edit allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare ctx jsonb; history jsonb; begin
  ctx=public.get_conference_team(false); history=public.get_conference_audit();
  if jsonb_array_length(ctx->'data'->'manifests')<>1 then raise exception 'Shared records missing'; end if;
  if jsonb_array_length(history)<>2 or exists(select 1 from jsonb_array_elements(history) e where e->>'actor_email'<>'confere-member@example.invalid') then raise exception 'Audit identity invalid'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform * from public.conference_states; raise exception 'Anonymous read'; exception when insufficient_privilege then null; end;
  begin perform public.get_conference_team(false); raise exception 'Anonymous team'; exception when insufficient_privilege then null; end;
  begin perform public.get_conference_audit(); raise exception 'Anonymous audit'; exception when insufficient_privilege then null; end;
  begin perform public.conference_reader_owner(); raise exception 'Anonymous reader lookup'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: team membership, shared saves, account isolation, immutable audit, stale/legacy writes and anonymous access' as security_tests;
rollback;
