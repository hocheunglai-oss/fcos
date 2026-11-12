-- Candidate SQL. Apply only after the reviewed native currency evidence columns exist.
create function public.finish_xero_native_hkd_payment_v1(
  p_tenant_id uuid, p_claim_id uuid, p_confirmation jsonb, p_actor_id uuid, p_actor_email text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  claim public.xero_financial_sync_runs;
  journal jsonb;
  reviewed jsonb;
  fx jsonb;
  saved public.xero_financial_payment_mappings;
  source_id text;
  target_id text;
  target_bank text;
  reviewed_date date;
  confirmation jsonb;
begin
  if p_tenant_id is null or p_claim_id is null or p_actor_id is null
    or nullif(btrim(p_actor_email), '') is null or jsonb_typeof(p_confirmation) is distinct from 'object' then
    raise exception 'Complete native payment confirmation and actor required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(192837465, 731);
  select * into claim from public.xero_financial_sync_runs where id = p_claim_id for update;
  journal := claim.control_totals->'paymentPosting';
  reviewed := journal->'reviewed';
  fx := reviewed->'nativeHkdMapping';
  source_id := reviewed->>'salesforcePaymentId';
  target_id := p_confirmation->>'paymentId';
  target_bank := reviewed->>'bankAccountId';
  if claim.id is null or claim.mode <> 'payment_apply'
    or journal->>'tenantId' is distinct from p_tenant_id::text
    or claim.reviewed_by is distinct from p_actor_id
    or lower(claim.reviewed_by_email) is distinct from lower(btrim(p_actor_email))
    or reviewed->>'currency' is distinct from 'HKD' or reviewed ? 'bankSourceEvidence'
    or coalesce(source_id, '') !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
    or journal->>'paymentId' is distinct from left(source_id, 15)
    or claim.source_fingerprint is distinct from reviewed->>'sourceFingerprint'
    or coalesce(reviewed->>'reviewFingerprint', '') = ''
    or jsonb_typeof(fx) is distinct from 'object' then
    raise exception 'Exact reviewed native HKD payment claim required' using errcode = '40001';
  end if;
  if coalesce(target_id, '') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or target_id = '00000000-0000-0000-0000-000000000000'
    or p_confirmation->>'invoiceId' is distinct from reviewed->>'xeroDocumentId'
    or p_confirmation->>'bankAccountId' is distinct from target_bank
    or p_confirmation->>'currency' is distinct from 'HKD'
    or p_confirmation->>'date' is distinct from reviewed->>'paymentDate'
    or p_confirmation->'amount' is distinct from reviewed->'amount'
    or p_confirmation->'bankAmount' is distinct from fx->'expectedBankAmount'
    or p_confirmation->'currencyRate' is distinct from fx->'expectedXeroRate'
    or p_confirmation->>'reference' is distinct from reviewed#>>'{proposedPayment,Reference}'
    or coalesce(p_confirmation->>'reference', '') = ''
    or fx#>>'{currencyEvidence,documentCurrency}' is distinct from 'HKD'
    or fx#>'{currencyEvidence,nativeAmount}' is distinct from reviewed->'amount'
    or fx#>>'{currencyEvidence,rateRevision}' is distinct from fx->>'companyFxRevision' then
    raise exception 'Native payment readback differs from the original reviewed claim' using errcode = '22023';
  end if;
  reviewed_date := (reviewed->>'paymentDate')::date;
  confirmation := jsonb_build_object(
    'paymentId', target_id, 'invoiceId', p_confirmation->>'invoiceId', 'bankAccountId', target_bank,
    'currency', 'HKD', 'date', reviewed_date, 'amount', p_confirmation->'amount',
    'bankAmount', p_confirmation->'bankAmount', 'currencyRate', p_confirmation->'currencyRate',
    'reference', p_confirmation->>'reference'
  );
  if journal->>'state' = 'confirmed' then
    select * into saved from public.xero_financial_payment_mappings where left(salesforce_payment_id, 15) = left(source_id, 15);
    if claim.status <> 'completed' or journal->'nativeHkdConfirmation' is distinct from confirmation
      or saved.id is null or saved.xero_payment_id is distinct from target_id
      or saved.document_mapping_id is distinct from (reviewed->>'documentMappingId')::uuid
      or saved.source_fingerprint is distinct from claim.source_fingerprint
      or saved.xero_bank_account_id is distinct from target_bank or saved.currency is distinct from 'HKD'
      or saved.amount is distinct from (reviewed->>'amount')::numeric or saved.payment_date is distinct from reviewed_date
      or saved.currency_evidence is distinct from fx->'currencyEvidence'
      or saved.accounting_usd is distinct from (fx->>'accountingUsd')::numeric
      or saved.invoice_carrying_usd is distinct from (fx->>'invoiceCarryingUsd')::numeric
      or saved.settlement_fx_usd is distinct from (fx->>'settlementFxUsd')::numeric
      or saved.company_fx_rate is distinct from (fx->>'companyFxRate')::numeric
      or saved.company_fx_revision is distinct from fx->>'companyFxRevision'
      or saved.xero_currency_rate is distinct from (confirmation->>'currencyRate')::numeric
      or saved.xero_bank_amount is distinct from (confirmation->>'bankAmount')::numeric then
      raise exception 'Completed native payment no longer matches its exact confirmation' using errcode = '40001';
    end if;
    return jsonb_build_object('mappingId', saved.id, 'reused', true);
  end if;
  if journal->>'state' is null or journal->>'state' not in ('intent', 'uncertain')
    or claim.status not in ('processing', 'failed')
    or (journal ? 'confirmedPaymentId' and journal->>'confirmedPaymentId' is distinct from target_id) then
    raise exception 'Original unresolved native payment claim required' using errcode = '40001';
  end if;
  perform 1 from public.xero_financial_document_mappings
    where id = (reviewed->>'documentMappingId')::uuid and xero_document_id = confirmation->>'invoiceId'
      and salesforce_id = fx->>'salesforceInvoiceId' and currency = 'HKD'
    for share;
  if not found then
    raise exception 'The original native invoice mapping is stale' using errcode = '40001';
  end if;
  insert into public.xero_financial_payment_mappings(
    salesforce_payment_id, salesforce_payment_name, document_mapping_id, source_fingerprint, xero_payment_id,
    xero_bank_account_id, amount, currency, payment_date, status, accounting_usd, invoice_carrying_usd,
    settlement_fx_usd, company_fx_rate, company_fx_revision, currency_evidence, xero_currency_rate, xero_bank_amount
  ) values (
    source_id, reviewed->>'salesforcePaymentName', (reviewed->>'documentMappingId')::uuid, claim.source_fingerprint, target_id,
    target_bank, (reviewed->>'amount')::numeric, 'HKD', reviewed_date, 'applied', (fx->>'accountingUsd')::numeric,
    (fx->>'invoiceCarryingUsd')::numeric, (fx->>'settlementFxUsd')::numeric, (fx->>'companyFxRate')::numeric,
    fx->>'companyFxRevision', fx->'currencyEvidence', (confirmation->>'currencyRate')::numeric, (confirmation->>'bankAmount')::numeric
  ) returning * into saved;
  journal := journal || jsonb_build_object('state', 'confirmed', 'confirmedPaymentId', target_id,
    'observedPaymentIds', jsonb_build_array(target_id), 'nativeHkdConfirmation', confirmation);
  update public.xero_financial_sync_runs set status = 'completed', control_totals = jsonb_set(control_totals, '{paymentPosting}', journal),
    error_code = null, error_message = null, completed_at = now(), updated_at = now() where id = claim.id;
  insert into public.xero_financial_audit_events(run_id, event_type, outcome, actor_id, actor_email, record_counts, fingerprints)
    values (claim.id, 'payment_posting', 'confirmed', p_actor_id, lower(btrim(p_actor_email)), '{"payments":1}',
      jsonb_build_object('tenantId', p_tenant_id, 'paymentId', left(source_id, 15), 'source', claim.source_fingerprint,
        'review', reviewed->>'reviewFingerprint', 'idempotencyKey', claim.idempotency_key, 'paymentPosting', journal));
  return jsonb_build_object('mappingId', saved.id, 'reused', false);
end;
$$;
revoke all on function public.finish_xero_native_hkd_payment_v1(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.finish_xero_native_hkd_payment_v1(uuid, uuid, jsonb, uuid, text) to service_role;

-- Preserve the same authority across requests and prevent generic journal updates
-- from acknowledging a native payment before its matching mapping exists.
create function public.guard_xero_native_hkd_payment_claim_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  prior jsonb;
  next_claim jsonb;
  fx jsonb;
begin
  if tg_op <> 'INSERT' then prior := old.control_totals->'paymentPosting'; end if;
  if tg_op <> 'DELETE' then next_claim := new.control_totals->'paymentPosting'; end if;
  if coalesce(prior->'reviewed' ? 'nativeHkdMapping', false) then
    if tg_op = 'DELETE' or new.idempotency_key is distinct from old.idempotency_key
      or new.mode is distinct from old.mode or new.source_fingerprint is distinct from old.source_fingerprint
      or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_by_email is distinct from old.reviewed_by_email
      or next_claim->'reviewed' is distinct from prior->'reviewed'
      or next_claim->>'tenantId' is distinct from prior->>'tenantId'
      or next_claim->>'paymentId' is distinct from prior->>'paymentId'
      or (prior->>'state' = 'confirmed' and (next_claim is distinct from prior or new.status <> 'completed')) then
      raise exception 'Native HKD payment claim and reviewed evidence are immutable' using errcode = '40001';
    end if;
  elsif tg_op = 'UPDATE' and coalesce(next_claim->'reviewed' ? 'nativeHkdMapping', false) then
    raise exception 'Native HKD evidence must be bound when the original claim is inserted' using errcode = '40001';
  end if;
  if not coalesce(next_claim->'reviewed' ? 'nativeHkdMapping', false) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  fx := next_claim#>'{reviewed,nativeHkdMapping}';
  if tg_op = 'INSERT' and (new.mode <> 'payment_apply' or new.status <> 'processing'
    or next_claim->>'state' is distinct from 'intent' or next_claim#>>'{reviewed,currency}' is distinct from 'HKD'
    or jsonb_typeof(fx->'expectedBankAmount') is distinct from 'number'
    or jsonb_typeof(fx->'expectedXeroRate') is distinct from 'number'
    or (fx->>'expectedBankAmount')::numeric <= 0 or (fx->>'expectedXeroRate')::numeric <= 0
    or fx->>'bankCurrency' is null or fx->>'bankCurrency' not in ('USD', 'HKD')
    or fx#>>'{currencyEvidence,documentCurrency}' is distinct from 'HKD'
    or fx#>'{currencyEvidence,nativeAmount}' is distinct from next_claim#>'{reviewed,amount}'
    or coalesce(fx->>'companyFxRevision', '') = ''
    or fx#>>'{currencyEvidence,rateRevision}' is distinct from fx->>'companyFxRevision') then
    raise exception 'Complete HKD evidence is required before recording payment intent' using errcode = '22023';
  end if;
  if next_claim->>'state' = 'confirmed' or new.status = 'completed' then
    if next_claim->>'state' is distinct from 'confirmed' or new.status <> 'completed'
      or not exists (
        select 1 from public.xero_financial_payment_mappings
        where left(salesforce_payment_id, 15) = next_claim->>'paymentId'
          and xero_payment_id = next_claim#>>'{nativeHkdConfirmation,paymentId}'
          and source_fingerprint = new.source_fingerprint and currency = 'HKD'
          and currency_evidence = fx->'currencyEvidence'
          and amount = (next_claim#>>'{reviewed,amount}')::numeric
      ) then
      raise exception 'Native HKD completion requires its exact saved payment mapping' using errcode = '40001';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_xero_native_hkd_payment_claim
  before insert or update or delete on public.xero_financial_sync_runs
  for each row execute function public.guard_xero_native_hkd_payment_claim_v1();
revoke all on function public.guard_xero_native_hkd_payment_claim_v1() from public, anon, authenticated;

create function public.claim_xero_native_hkd_payment_v1(
  p_tenant_id uuid, p_row jsonb, p_actor_id uuid, p_actor_email text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  fx jsonb := p_row->'nativeHkdMapping';
  request jsonb := p_row->'proposedPayment';
  source_id text := p_row->>'salesforcePaymentId';
  canonical_id text;
  claim_key text;
  claim public.xero_financial_sync_runs;
  journal jsonb;
  amount numeric;
  bank_amount numeric;
  cash_usd numeric;
  carrying_usd numeric;
  company_rate numeric;
  expected_xero_rate numeric;
  bank_currency text := fx->>'bankCurrency';
  base_currency text := fx->>'baseCurrency';
begin
  if p_tenant_id is null or p_tenant_id = '00000000-0000-0000-0000-000000000000'
    or p_actor_id is null or p_actor_id = '00000000-0000-0000-0000-000000000000'
    or nullif(btrim(p_actor_email), '') is null
    or coalesce(source_id, '') !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
    or coalesce(p_row->>'sourceFingerprint', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_row->>'reviewFingerprint', '') !~ '^[a-f0-9]{64}$'
    or p_row->>'action' is distinct from 'payment_apply' or p_row->>'status' is distinct from 'eligible'
    or p_row->>'currency' is distinct from 'HKD' or p_row->'blockers' is distinct from '[]'::jsonb
    or p_row->>'type' is null or p_row->>'type' not in ('Payable', 'Receivable')
    or p_row ? 'bankSourceEvidence' or p_row ? 'ordinaryRemittanceCashEvidence'
    or jsonb_typeof(fx) is distinct from 'object' or jsonb_typeof(request) is distinct from 'object'
    or coalesce(bank_currency, '') not in ('USD', 'HKD') or coalesce(base_currency, '') not in ('USD', 'HKD')
    or jsonb_typeof(p_row->'amount') is distinct from 'number'
    or exists (select 1 from unnest(array['expectedBankAmount','expectedXeroRate','accountingUsd','invoiceCarryingUsd','settlementFxUsd','companyFxRate']) key
      where jsonb_typeof(fx->key) is distinct from 'number') then
    raise exception 'A complete eligible native HKD payment review is required' using errcode = '22023';
  end if;
  amount := (p_row->>'amount')::numeric;
  bank_amount := (fx->>'expectedBankAmount')::numeric;
  cash_usd := (fx->>'accountingUsd')::numeric;
  carrying_usd := (fx->>'invoiceCarryingUsd')::numeric;
  company_rate := (fx->>'companyFxRate')::numeric;
  if amount <= 0 or bank_amount <= 0 or cash_usd <= 0 or carrying_usd <= 0 or company_rate <= 0 or company_rate > 100
    or scale(amount) > 2 or scale(bank_amount) > 2 or scale(company_rate) > 6
    or round(amount / company_rate, 2) <> cash_usd
    or (fx->>'settlementFxUsd')::numeric <> (case when p_row->>'type' = 'Payable' then carrying_usd - cash_usd else cash_usd - carrying_usd end) then
    raise exception 'Native HKD payment amounts differ from the reviewed accounting evidence' using errcode = '22023';
  end if;
  expected_xero_rate := case when bank_currency = 'USD'
    then round(case when base_currency = 'USD' then amount / bank_amount else bank_amount / amount end, 12)
    when base_currency = 'USD' then company_rate else 1 end;
  if (fx->>'expectedXeroRate')::numeric <> expected_xero_rate
    or nullif(btrim(request->>'Reference'), '') is null
    or request is distinct from (
      jsonb_build_object('Invoice', jsonb_build_object('InvoiceID', p_row->>'xeroDocumentId'),
        'Account', jsonb_build_object('AccountID', p_row->>'bankAccountId'),
        'Amount', amount, 'Date', p_row->>'paymentDate', 'Reference', request->>'Reference')
      || case when bank_currency = 'USD' then jsonb_build_object('BankAmount', bank_amount)
        when base_currency = 'USD' then jsonb_build_object('CurrencyRate', company_rate) else '{}'::jsonb end
    )
    or bank_amount <> (case when bank_currency = 'USD' then cash_usd else amount end) then
    raise exception 'Native HKD provider request differs from the reviewed payment' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(192837465, 731);
  canonical_id := left(source_id, 15);
  claim_key := 'payment-post:' || encode(sha256(convert_to('["' || p_tenant_id::text || '","' || canonical_id || '"]','UTF8')), 'hex');
  if exists (select 1 from public.xero_financial_payment_mappings where left(salesforce_payment_id, 15) = canonical_id)
    or exists (select 1 from public.xero_financial_sync_runs where mode = 'payment_apply' and (
      idempotency_key = claim_key or left(control_totals#>>'{paymentPosting,paymentId}', 15) = canonical_id
    )) then
    return jsonb_build_object('alreadyClaimed', true, 'claim', null);
  end if;
  perform 1 from public.xero_financial_document_mappings
    where id = (p_row->>'documentMappingId')::uuid and xero_document_id = p_row->>'xeroDocumentId'
      and salesforce_id = fx->>'salesforceInvoiceId' and currency = 'HKD'
      and xero_document_type = case when p_row->>'type' = 'Payable' then 'ACCPAY' else 'ACCREC' end for share;
  if not found then raise exception 'The original native invoice mapping is stale' using errcode = '40001'; end if;
  perform 1 from public.xero_financial_bank_mappings
    where upper(btrim(salesforce_bank_name)) = upper(btrim(p_row->>'bank'))
      and xero_bank_account_id = p_row->>'bankAccountId' for share;
  if not found then raise exception 'The original native payment bank mapping is stale' using errcode = '40001'; end if;
  journal := jsonb_build_object('tenantId', p_tenant_id, 'paymentId', canonical_id, 'reviewed', p_row, 'state', 'intent');
  insert into public.xero_financial_sync_runs(mode, status, idempotency_key, source_fingerprint, control_totals,
    created_by, created_by_email, reviewed_by, reviewed_by_email, reviewed_at)
    values ('payment_apply', 'processing', claim_key, p_row->>'sourceFingerprint', jsonb_build_object('paymentPosting', journal),
      p_actor_id, lower(btrim(p_actor_email)), p_actor_id, lower(btrim(p_actor_email)), now()) returning * into claim;
  insert into public.xero_financial_audit_events(run_id, event_type, outcome, actor_id, actor_email, record_counts, fingerprints)
    values (claim.id, 'payment_posting', 'intent', p_actor_id, lower(btrim(p_actor_email)), '{"payments":1}',
      jsonb_build_object('tenantId', p_tenant_id, 'paymentId', canonical_id, 'source', p_row->>'sourceFingerprint',
        'review', p_row->>'reviewFingerprint', 'idempotencyKey', claim_key, 'paymentPosting', journal));
  return jsonb_build_object('alreadyClaimed', false, 'claim', to_jsonb(claim));
end;
$$;
revoke all on function public.claim_xero_native_hkd_payment_v1(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_xero_native_hkd_payment_v1(uuid, jsonb, uuid, text) to service_role;
