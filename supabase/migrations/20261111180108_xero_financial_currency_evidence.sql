begin;

-- Nullable additions preserve existing mappings without inventing historical FX evidence.
alter table public.xero_financial_payment_mappings
  add column accounting_usd numeric(18, 2),
  add column invoice_carrying_usd numeric(18, 2),
  add column settlement_fx_usd numeric(18, 2),
  add column company_fx_rate numeric(12, 6),
  add column company_fx_revision varchar(80),
  add column currency_evidence jsonb,
  add column currency_reconciliation jsonb,
  add column xero_currency_rate numeric(28, 12),
  add column xero_bank_amount numeric(18, 2),
  add column xero_warnings jsonb;

alter table public.xero_financial_payment_mappings
  add constraint xero_payment_company_fx_rate_valid
    check (company_fx_rate is null or (company_fx_rate > 0 and company_fx_rate <= 100)),
  add constraint xero_payment_hkd_evidence_required
    check (currency is distinct from 'HKD' or coalesce((
      accounting_usd is not null
      and company_fx_rate is not null
      and nullif(trim(company_fx_revision), '') is not null
      and jsonb_typeof(currency_evidence) = 'object'
      and currency_evidence ->> 'documentCurrency' = 'HKD'
      and jsonb_typeof(currency_evidence -> 'nativeAmount') = 'number'
      and currency_evidence ->> 'rateRevision' = company_fx_revision
    ), false)) not valid;

alter table public.xero_financial_document_mappings
  add column currency text check (currency is null or currency in ('USD', 'HKD')),
  add column accounting_usd numeric(18, 2),
  add column company_fx_rate numeric(12, 6),
  add column company_fx_revision varchar(80),
  add column currency_evidence jsonb,
  add column xero_currency_rate numeric(28, 12);

alter table public.xero_financial_document_mappings
  add constraint xero_document_company_fx_rate_valid
    check (company_fx_rate is null or (company_fx_rate > 0 and company_fx_rate <= 100)),
  add constraint xero_document_hkd_evidence_required
    check (currency is distinct from 'HKD' or coalesce((
      accounting_usd is not null
      and company_fx_rate is not null
      and nullif(trim(company_fx_revision), '') is not null
      and jsonb_typeof(currency_evidence) = 'object'
      and currency_evidence ->> 'documentCurrency' = 'HKD'
      and jsonb_typeof(currency_evidence -> 'nativeAmount') = 'number'
      and currency_evidence ->> 'rateRevision' = company_fx_revision
    ), false)) not valid;

-- No grants, RLS changes, updates, deletes, or fabricated backfill.
commit;
