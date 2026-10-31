-- Read-only: reports which migrations in supabase/migrations are present in
-- this database. Run it in the Supabase SQL editor. It changes nothing.
-- Each migration is identified by an object or code fragment only it creates.
with fn(sig, def) as (
  select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
has_fn(name) as (select sig from fn),
checks(migration, applied, detail) as (values
  ('20261011040000_conference',
    to_regclass('public.conference_states') is not null,
    'tabela conference_states'),
  ('20261013040000_teams',
    to_regclass('public.conference_audit') is not null
      and exists(select 1 from has_fn where name = 'save_team_conference(jsonb,jsonb)'),
    'equipes, auditoria e save_team_conference'),
  ('20261013050000_reader_team_access',
    true,
    'função da leitura por IA; removida de propósito por 20261030010000'),
  ('20261013060000_team_members_and_merge',
    exists(select 1 from fn where sig = 'invite_conference_member(text)')
      and not exists(select 1 from fn where sig in ('invite_conference_member(text)','get_conference_team(boolean)')
        and def like '%Equipe completa%'),
    'sem limite de 3 integrantes'),
  ('20261014010000_manifest_corrections',
    exists(select 1 from fn where sig = 'save_team_conference(jsonb,jsonb)' and def like '%previousIds%'),
    'correção de número do pré (previousIds)'),
  ('20261014020000_ctc_identity_conflicts',
    exists(select 1 from fn where sig = 'save_team_conference(jsonb,jsonb)'
      and def like '%A CTC identity correction cannot merge%'),
    'conflito de identidade de CTC'),
  ('20261014030000_export_manifest_ids',
    exists(select 1 from fn where sig = 'save_team_conference(jsonb,jsonb)'
      and def like '%(DI[0-9]{8,12}|[0-9]{8,12})%'),
    'IDs numéricos da planilha'),
  ('20261015090000_remanifested_routes',
    exists(select 1 from has_fn where name = 'conference_has_ctc_conflicts(jsonb)'),
    'rotas remanifestadas'),
  ('20261015110000_manifest_schedule_metadata',
    exists(select 1 from fn where sig = 'save_team_conference(jsonb,jsonb)' and def like '%issueTime%'),
    'horário de emissão e previsão de entrega'),
  ('20261016010000_personal_team_demands',
    exists(select 1 from has_fn where name like 'conference_manifest_creator(%'),
    'autor do cadastro atribuído pelo servidor'),
  ('20261016020000_visible_action_actors',
    exists(select 1 from has_fn where name like 'conference_manifest_actions(%'),
    'autor visível das ações'),
  ('20261016030000_latest_nf_occurrences',
    exists(select 1 from has_fn where name like 'conference_latest_nf_occurrences(%'),
    'ocorrências de NF'),
  ('20261017010000_security_hardening',
    exists(select 1 from has_fn where name = 'conference_validate_input(jsonb)')
      and exists(select 1 from has_fn where name = 'conference_require_confirmed_user()'),
    'validação de entrada e conta confirmada'),
  ('20261017020000_security_scalar_types',
    exists(select 1 from fn where sig = 'conference_validate_input(jsonb)' and def like '%Strict scalar types%'),
    'tipos estritos na validação'),
  ('20261018010000_shared_personal_demands',
    exists(select 1 from has_fn where name like 'conference_manifest_demands(%'),
    'demandas pessoais compartilhadas'),
  ('20261018020000_personal_receipt_acceptance',
    exists(select 1 from has_fn where name like 'conference_prepare_receipts(%'),
    'confirmações pessoais de recebimento'),
  ('20261030010000_remove_photo_ai',
    to_regclass('public.conference_reader_limits') is null
      and not exists(select 1 from has_fn where name in ('conference_reader_owner()','consume_conference_reader_quota()')),
    'objetos da leitura por IA removidos'),
  ('20261030020000_conference_archive',
    to_regclass('public.conference_archive') is not null
      and exists(select 1 from has_fn where name = 'save_team_conference_v2(jsonb,jsonb)'),
    'arquivo de prés finalizados'),
  ('20261030030000_roles_settings_monitoring',
    to_regclass('public.conference_owner_allowlist') is not null
      and to_regclass('public.conference_client_errors') is not null
      and exists(select 1 from has_fn where name = 'set_conference_settings(text[],text[])'),
    'papéis, cadastro por convite, filial configurável e registro de erros')
)
select migration as "migração",
  case when applied then 'aplicada' else 'FALTANDO' end as "situação",
  detail as "o que verifica"
from checks order by migration;
