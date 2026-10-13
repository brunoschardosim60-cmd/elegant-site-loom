-- The OCR service belongs to the configured service owner's team, not to any
-- arbitrary account that registers on the public login screen.
create function public.conference_reader_owner() returns text
language sql stable security definer set search_path='' as $$
  select lower(u.email) from public.conference_members m
  join public.conference_teams t on t.id=m.team_id
  join auth.users u on u.id=t.owner_id
  where m.user_id=auth.uid()
$$;
revoke all on function public.conference_reader_owner() from public,anon;
grant execute on function public.conference_reader_owner() to authenticated;
