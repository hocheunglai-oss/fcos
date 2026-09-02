-- The bank RPCs use pgcrypto fingerprints while keeping their search paths fixed.
-- Production received the base migration before database lint exposed that pgcrypto
-- is installed in the extensions schema, so update only these governed functions.

alter function public.save_cashflow_bank_account_v1(uuid,text,text,text,text,text,text,boolean,boolean,integer,uuid,text)
  set search_path = public, extensions, pg_temp;
alter function public.save_cashflow_bank_balance_v1(uuid,uuid,date,numeric,numeric,text,integer,uuid,text)
  set search_path = public, extensions, pg_temp;
alter function public.import_cashflow_bank_statement_v1(uuid,text,text,jsonb,uuid,text)
  set search_path = public, extensions, pg_temp;
alter function public.save_cashflow_bank_match_v1(uuid,text,text,text,text,integer,uuid,text)
  set search_path = public, extensions, pg_temp;
alter function public.save_cashflow_liquidity_instrument_v1(uuid,uuid,text,text,numeric,numeric,date,date,text,text,boolean,text,integer,uuid,text)
  set search_path = public, extensions, pg_temp;
alter function public.save_cashflow_bank_planned_movement_v1(uuid,uuid,text,text,text,numeric,date,text,date,boolean,integer,uuid,text)
  set search_path = public, extensions, pg_temp;
