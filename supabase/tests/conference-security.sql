-- Run in SQL Editor. All fixtures are rolled back; no real account is changed.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select public.save_conference(0,'{"manifests":[],"activity":[],"issues":[]}');
do $$ begin
  if (select count(*) from public.conference_states) <> 1 then raise exception 'Owner read failed'; end if;
  begin
    perform public.save_conference(0,'{}');
    raise exception 'Stale revision incorrectly accepted';
  exception when others then
    if sqlerrm <> 'CONFERENCE_CONFLICT' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.conference_states) <> 0 then raise exception 'Cross-account read allowed'; end if;
  update public.conference_states set data='{}' where user_id='11111111-1111-4111-8111-111111111111';
  if found then raise exception 'Cross-account write allowed'; end if;
  begin
    insert into public.conference_states(user_id) values ('11111111-1111-4111-8111-111111111111');
    raise exception 'Cross-account insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.conference_states;
    raise exception 'Anonymous read allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_conference(0,'{}');
    raise exception 'Anonymous save allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS: owner read/write, account isolation, stale revisions, anonymous access' as security_tests;
rollback;
