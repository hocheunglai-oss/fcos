-- A complete immutable preview can require more than the authenticator's 8s
-- default to verify/publish every staged item and validate a complete campaign.
-- Both complete campaign creation and refresh hit the same evidence checks.
-- PostgREST hoists each function-local setting to its RPC transaction.
-- Keep a bounded 45s budget;
-- change no function body, role/database defaults, grants, or evidence controls.
alter function public.finalize_xero_financial_preview_v2(uuid,text)
  set statement_timeout to '45s';
alter function public.xero_campaign_create_v1(uuid,uuid,uuid,integer,jsonb)
  set statement_timeout to '45s';
alter function public.xero_campaign_refresh_v1(uuid,uuid,integer,uuid,integer,jsonb)
  set statement_timeout to '45s';

-- Function settings are cached by PostgREST; refresh only the schema cache.
notify pgrst, 'reload schema';
