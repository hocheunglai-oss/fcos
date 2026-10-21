-- Complete campaign evidence is about 14 MB for the current backlog. Its
-- verified inventory write must not inherit the API role's 8s default.
-- Match the existing complete-preview budget, scoped to this one checked RPC.
-- PostgREST hoists the function setting; preserve all checks, body and grants.
alter function public.xero_campaign_inventory_v1(uuid,uuid,uuid,jsonb)
  set statement_timeout to '45s';
notify pgrst, 'reload schema';
