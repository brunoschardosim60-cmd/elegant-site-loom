-- Each account owns its conference. Optimistic revision prevents one device
-- from silently overwriting changes saved by another device.
create table public.conference_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  data jsonb not null default '{"manifests":[],"activity":[],"issues":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint conference_data_object check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 5000000)
);
alter table public.conference_states enable row level security;
create policy "Read own conference" on public.conference_states for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own conference" on public.conference_states for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own conference" on public.conference_states for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.conference_states from anon;
grant select, insert, update on public.conference_states to authenticated;

create function public.save_conference(expected_revision bigint, next_data jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare new_revision bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.conference_states(user_id) values (auth.uid()) on conflict do nothing;
  update public.conference_states set data = next_data, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() and revision = expected_revision returning revision into new_revision;
  if new_revision is null then raise exception 'CONFERENCE_CONFLICT'; end if;
  return new_revision;
end;
$$;
revoke all on function public.save_conference(bigint,jsonb) from public, anon;
grant execute on function public.save_conference(bigint,jsonb) to authenticated;
