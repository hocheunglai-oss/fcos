-- Complete document-only reviews still use the atomic v1 publisher. The
-- authenticator's short timeout cancelled its evidence normalization for the
-- 3,005-row 2026 review. Match the bounded budget of the staged publisher;
-- preserve the function body, role defaults, grants and approval controls.
alter function public.persist_xero_financial_preview_v1(jsonb,jsonb,text)
  set statement_timeout to '45s';

notify pgrst, 'reload schema';
