-- Photo reading now runs only in the browser (local OCR). The server-side AI
-- reader, its team authorization lookup and its per-account request budget
-- are no longer used by the application.
begin;
drop function if exists public.consume_conference_reader_quota();
drop table if exists public.conference_reader_limits;
drop function if exists public.conference_reader_owner();
commit;
