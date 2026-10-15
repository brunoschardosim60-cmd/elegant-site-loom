-- Allow literal exported manifesto IDs alongside existing DI photo prés.
-- Only the accepted ID pattern changes; no records, permissions or audit change.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.save_team_conference(jsonb,jsonb)'::regprocedure);
  if position('^(DI[0-9]{8,12}|[0-9]{8,12})$' in definition) > 0 then return; end if;
  if position('^DI[0-9]{8,12}$' in definition) = 0 then
    raise exception 'Unexpected conference RPC version; review the ID validation before applying';
  end if;
  execute replace(definition, '^DI[0-9]{8,12}$', '^(DI[0-9]{8,12}|[0-9]{8,12})$');
end
$migration$;
