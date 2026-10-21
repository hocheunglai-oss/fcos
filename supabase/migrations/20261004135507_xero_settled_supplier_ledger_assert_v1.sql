-- Pure service-only snapshot assertions. No tables, provider calls, cash proof,
-- source-payment linkage, approval, registration or paid-document activation.
-- Original provider fields are retained; canonical incompatibility is a hold.
create function public.xero_settled_supplier_cents_v1(p_value jsonb)
returns bigint language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp as $$
declare v text; n numeric;
begin
  if current_user is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  v := p_value #>> '{}';
  if coalesce(jsonb_typeof(p_value), '') not in ('string', 'number')
    or coalesce(v, '') ~ '[^0-9.]'
    or coalesce(v, '') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?$' then
    raise exception 'Missing or invalid unsigned exact cents' using errcode = '40001';
  end if;
  n := v::numeric * 100;
  if n <> trunc(n) then
    raise exception 'Subcent evidence is unsupported' using errcode = '40001';
  end if;
  return n::bigint;
end $$;

create function public.xero_settled_supplier_snapshot_assert_v1(p_originals jsonb)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
declare
  invoice jsonb; organisation jsonb; summary jsonb; payment jsonb; account jsonb;
  nested_invoice jsonb; nested_account jsonb; projected jsonb; projected_payment jsonb;
  row jsonb; value jsonb; paid_date jsonb; k text; day text; total bigint;
  rows jsonb[]; invoices jsonb[]; summaries jsonb[]; accounts jsonb[];
  node_count integer; max_depth integer; refund boolean;
  uuid_pattern constant text := '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
  nil_uuid constant text := '00000000-0000-0000-0000-000000000000';
  trim_chars constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if current_user is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_originals) is distinct from 'object'
    or octet_length(p_originals::text) > 2000000 then
    raise exception 'Incomplete or oversized raw ledger snapshot' using errcode = '40001';
  end if;
  -- LIMIT caps recursive production before aggregation; depth 25 is observed
  -- but never expanded. This checks original JSON nodes, not derived evidence.
  with recursive walk(v, d) as (
    select p_originals, 0
    union all
    select child.v, walk.d + 1 from walk cross join lateral (
      select fields.value v from jsonb_each(case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}'::jsonb end) fields
      union all
      select elements.value v from jsonb_array_elements(case when jsonb_typeof(walk.v) = 'array' then walk.v else '[]'::jsonb end) elements
    ) child where walk.d < 25
  ) select count(*), max(d), bool_or(jsonb_typeof(v) = 'object' and (v ? 'Refunds' or v ? 'AmountRefunded'))
    into node_count, max_depth, refund from (select v, d from walk limit 100001) bounded;
  if node_count > 100000 or max_depth > 24 or refund then
    raise exception 'Bounded refund-free original JSON required' using errcode = '40001';
  end if;
  if octet_length(public.xero_document_correction_canonical_v1(p_originals)) > 1000000 then
    raise exception 'Bounded refund-free original JSON required' using errcode = '40001';
  end if;
  invoice := p_originals->'invoice'; organisation := p_originals->'organisation';
  if jsonb_typeof(invoice->'Payments') is distinct from 'array'
    or jsonb_typeof(p_originals->'payments') is distinct from 'array'
    or jsonb_typeof(p_originals->'accounts') is distinct from 'array' then
    raise exception 'Complete raw payment and account arrays required' using errcode = '40001';
  end if;
  if jsonb_array_length(invoice->'Payments') <> 1
    or jsonb_array_length(p_originals->'payments') <> 1
    or jsonb_array_length(p_originals->'accounts') <> 1 then
    raise exception 'Exactly one complete ledger payment and account required' using errcode = '40001';
  end if;
  summary := invoice#>'{Payments,0}'; payment := p_originals#>'{payments,0}';
  account := p_originals#>'{accounts,0}'; nested_account := payment->'Account'; nested_invoice := payment->'Invoice';
  rows := array[invoice, organisation, invoice->'Contact', summary, payment, account, nested_account, nested_invoice, nested_invoice->'Contact'];
  invoices := array[nested_invoice]; summaries := array[summary]; accounts := array[nested_account];
  if summary ? 'Invoice' then
    invoices := array_append(invoices, summary->'Invoice');
    rows := rows || array[summary->'Invoice', summary#>'{Invoice,Contact}'];
  end if;
  foreach row in array rows loop
    if jsonb_typeof(row) is distinct from 'object' then
      raise exception 'Incomplete material ledger row' using errcode = '40001';
    end if;
  end loop;
  foreach value in array array[p_originals->'tenantId', organisation->'OrganisationID', invoice->'InvoiceID',
    invoice#>'{Contact,ContactID}', summary->'PaymentID', payment->'PaymentID', account->'AccountID', nested_account->'AccountID',
    nested_invoice->'InvoiceID', nested_invoice#>'{Contact,ContactID}'] loop
    if jsonb_typeof(value) is distinct from 'string' or char_length(value#>>'{}') <> 36
      or coalesce(value#>>'{}', '') !~* uuid_pattern or value#>>'{}' = nil_uuid then
      raise exception 'Exact nonzero UUID identity required' using errcode = '40001';
    end if;
  end loop;
  if lower(p_originals->>'tenantId') is distinct from lower(organisation->>'OrganisationID')
    or organisation->>'BaseCurrency' is distinct from 'USD'
    or invoice->>'Status' is distinct from 'PAID' or invoice->>'Type' is distinct from 'ACCPAY'
    or invoice->>'CurrencyCode' is distinct from 'USD'
    or public.xero_settled_supplier_cents_v1(invoice->'CurrencyRate') <> 100 then
    raise exception 'Exact PAID USD ACCPAY tenant-bound target required' using errcode = '40001';
  end if;
  total := public.xero_settled_supplier_cents_v1(invoice->'Total');
  if total <= 0 or public.xero_settled_supplier_cents_v1(invoice->'AmountPaid') <> total
    or public.xero_settled_supplier_cents_v1(invoice->'AmountDue') <> 0
    or public.xero_settled_supplier_cents_v1(invoice->'AmountCredited') <> 0 then
    raise exception 'Full positive invoice balance must be paid without credits' using errcode = '40001';
  end if;
  foreach k in array array['CreditNotes', 'Prepayments', 'Overpayments'] loop
    if invoice->k is distinct from '[]'::jsonb then
      raise exception 'Explicit empty invoice settlement collections required' using errcode = '40001';
    end if;
  end loop;
  if public.xero_aggregate_supplier_calendar_date_v3(invoice, 'Date') is null
    or public.xero_aggregate_supplier_calendar_date_v3(invoice, 'DueDate') is null then
    raise exception 'Valid raw target calendar dates required' using errcode = '40001';
  end if;
  if lower(summary->>'PaymentID') is distinct from lower(payment->>'PaymentID')
    or payment->>'Status' is distinct from 'AUTHORISED' or payment->>'PaymentType' is distinct from 'ACCPAYPAYMENT'
    or payment->'HasAccount' is distinct from 'true'::jsonb
    or public.xero_settled_supplier_cents_v1(payment->'Amount') <> total
    or public.xero_settled_supplier_cents_v1(payment->'BankAmount') <> total
    or public.xero_settled_supplier_cents_v1(payment->'CurrencyRate') <> 100
    or public.xero_settled_supplier_cents_v1(summary->'Amount') <> total then
    raise exception 'Full authorised existing payment must settle exact target cents' using errcode = '40001';
  end if;
  day := public.xero_aggregate_supplier_calendar_date_v3(payment, 'Date');
  if day is null or public.xero_aggregate_supplier_calendar_date_v3(summary, 'Date') is distinct from day then
    raise exception 'Payment and summary calendar date mismatch' using errcode = '40001';
  end if;
  if account->>'Status' is distinct from 'ACTIVE' or account->>'Type' is distinct from 'BANK'
    or account->>'CurrencyCode' is distinct from 'USD' then
    raise exception 'Exact active USD ledger account required' using errcode = '40001';
  end if;
  foreach k in array array['Code', 'Name'] loop
    if jsonb_typeof(account->k) is distinct from 'string' or nullif(btrim(account->>k, trim_chars), '') is null
      or char_length(account->>k)*2-char_length(regexp_replace(account->>k, '['||chr(65536)||'-'||chr(1114111)||']', '', 'g')) > 2000
      or account->>k ~ ('['||chr(1)||'-'||chr(31)||chr(127)||']') then
      raise exception 'Bounded nonblank ledger code and name required' using errcode = '40001';
    end if;
  end loop;
  foreach k in array array['CreditNote', 'Prepayment', 'Overpayment'] loop
    if summary ? k or payment ? k and payment->k is distinct from 'null'::jsonb and payment->k is distinct from '[]'::jsonb then
      raise exception 'Noninvoice or conflicting payment association' using errcode = '40001';
    end if;
  end loop;
  -- Validate each supplied invoice projection without manufacturing absent facts.
  foreach projected in array invoices loop
    foreach value in array array[projected->'InvoiceID', projected#>'{Contact,ContactID}'] loop
      if jsonb_typeof(value) is distinct from 'string' or char_length(value#>>'{}') <> 36
        or coalesce(value#>>'{}', '') !~* uuid_pattern or value#>>'{}' = nil_uuid then
        raise exception 'Projected invoice identity invalid' using errcode = '40001';
      end if;
    end loop;
    if lower(projected->>'InvoiceID') is distinct from lower(invoice->>'InvoiceID')
      or lower(projected#>>'{Contact,ContactID}') is distinct from lower(invoice#>>'{Contact,ContactID}')
      or projected->>'Type' is distinct from 'ACCPAY' or projected->>'CurrencyCode' is distinct from 'USD'
      or projected ? 'Status' and projected->>'Status' is distinct from 'PAID' then
      raise exception 'Projected invoice association or paid state contradiction' using errcode = '40001';
    end if;
    foreach k in array array['Total', 'AmountPaid', 'AmountDue', 'AmountCredited', 'CurrencyRate'] loop
      if projected ? k and public.xero_settled_supplier_cents_v1(projected->k) <> public.xero_settled_supplier_cents_v1(invoice->k) then
        raise exception 'Projected invoice financial contradiction' using errcode = '40001';
      end if;
    end loop;
    foreach k in array array['Date', 'DueDate'] loop
      if (projected ? k or projected ? (k||'String')) and (
        public.xero_aggregate_supplier_calendar_date_v3(projected, k) is null
        or public.xero_aggregate_supplier_calendar_date_v3(projected, k) is distinct from public.xero_aggregate_supplier_calendar_date_v3(invoice, k)) then
        raise exception 'Projected invoice raw date contradiction' using errcode = '40001';
      end if;
    end loop;
    foreach k in array array['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'] loop
      if projected ? k then
        if jsonb_typeof(projected->k) is distinct from 'array' then
          raise exception 'Projected settlement collection incomplete' using errcode = '40001';
        end if;
        if jsonb_array_length(projected->k) > (case when k = 'Payments' then 1 else 0 end) then
          raise exception 'Projected settlement collection contradiction' using errcode = '40001';
        end if;
      end if;
    end loop;
    if projected ? 'Payments' and jsonb_array_length(projected->'Payments') = 1 then
      projected_payment := projected#>'{Payments,0}';
      if projected_payment ?| array['Invoice', 'CreditNote', 'Prepayment', 'Overpayment'] then
        raise exception 'Deeper payment association is outside snapshot contract' using errcode = '40001';
      end if;
      summaries := array_append(summaries, projected_payment);
      rows := array_append(rows, projected_payment);
      if projected_payment ? 'BankAmount' and public.xero_settled_supplier_cents_v1(projected_payment->'BankAmount') <> total then
        raise exception 'Projected bank amount contradiction' using errcode = '40001';
      end if;
    end if;
  end loop;
  foreach row in array array[invoice] || invoices loop
    if row ? 'FullyPaidOnDate' or row ? 'FullyPaidOnDateString' then
      paid_date := jsonb_build_object('Date', row->'FullyPaidOnDate');
      if row ? 'FullyPaidOnDateString' then paid_date := paid_date || jsonb_build_object('DateString', row->'FullyPaidOnDateString'); end if;
      if public.xero_aggregate_supplier_calendar_date_v3(paid_date, 'Date') is distinct from day then
        raise exception 'Fully paid calendar date contradiction' using errcode = '40001';
      end if;
    end if;
  end loop;
  foreach row in array summaries loop
    if row ? 'BankAmount' and public.xero_settled_supplier_cents_v1(row->'BankAmount') <> total then
      raise exception 'Projected bank amount contradiction' using errcode = '40001';
    end if;
    if jsonb_typeof(row) is distinct from 'object'
      or jsonb_typeof(row->'PaymentID') is distinct from 'string' or char_length(row->>'PaymentID') <> 36
      or coalesce(row->>'PaymentID', '') !~* uuid_pattern or lower(row->>'PaymentID') is distinct from lower(payment->>'PaymentID')
      or public.xero_settled_supplier_cents_v1(row->'Amount') <> total
      or public.xero_aggregate_supplier_calendar_date_v3(row, 'Date') is distinct from day then
      raise exception 'Projected payment ID cents or date contradiction' using errcode = '40001';
    end if;
    foreach k in array array['CurrencyRate', 'Reference', 'PaymentType', 'Status'] loop
      if row ? k then
        if not(payment ? k) or (k = 'CurrencyRate' and public.xero_settled_supplier_cents_v1(row->k) <> 100)
          or (k <> 'CurrencyRate' and row->k is distinct from payment->k) then
          raise exception 'Projected payment metadata contradiction' using errcode = '40001';
        end if;
      end if;
    end loop;
    if row ? 'HasAccount' and jsonb_typeof(row->'HasAccount') is distinct from 'boolean' then
      raise exception 'Projected HasAccount must be Boolean; false is legitimate summary evidence' using errcode = '40001';
    end if;
    if row ? 'Account' then
      accounts := array_append(accounts, row->'Account'); rows := array_append(rows, row->'Account');
    end if;
  end loop;
  foreach row in array summaries || array[payment] loop
    if row ? 'CurrencyCode' and row->>'CurrencyCode' is distinct from 'USD' then
      raise exception 'Payment currency contradiction' using errcode = '40001';
    end if;
    if row ? 'InvoiceID' then
      value := row->'InvoiceID';
      if jsonb_typeof(value) is distinct from 'string' or char_length(value#>>'{}') <> 36
        or coalesce(value#>>'{}', '') !~* uuid_pattern or lower(value#>>'{}') is distinct from lower(invoice->>'InvoiceID') then
        raise exception 'Payment direct invoice association contradiction' using errcode = '40001';
      end if;
    end if;
    if row ? 'Reference' and (jsonb_typeof(row->'Reference') is distinct from 'string'
      or char_length(row->>'Reference')*2-char_length(regexp_replace(row->>'Reference', '['||chr(65536)||'-'||chr(1114111)||']', '', 'g')) > 2000
      or row->>'Reference' ~ ('['||chr(1)||'-'||chr(31)||chr(127)||']')) then
      raise exception 'Invalid bounded payment reference' using errcode = '40001';
    end if;
  end loop;
  foreach row in array accounts loop
    value := row->'AccountID';
    if jsonb_typeof(row) is distinct from 'object' or jsonb_typeof(value) is distinct from 'string'
      or char_length(value#>>'{}') <> 36 or coalesce(value#>>'{}', '') !~* uuid_pattern
      or lower(value#>>'{}') is distinct from lower(account->>'AccountID') then
      raise exception 'Projected account identity contradiction' using errcode = '40001';
    end if;
    foreach k in array array['Code', 'CurrencyCode', 'Name', 'Type', 'Status'] loop
      if row ? k and row->k is distinct from account->k then
        raise exception 'Projected account metadata contradiction' using errcode = '40001';
      end if;
    end loop;
  end loop;
  foreach row in array rows loop
    foreach k in array array['HasErrors', 'HasValidationErrors', 'IsDeleted'] loop
      if row ? k and row->k is distinct from 'false'::jsonb then
        raise exception 'Material provider error or deletion evidence' using errcode = '40001';
      end if;
    end loop;
    if row ? 'ValidationErrors' and row->'ValidationErrors' is distinct from '[]'::jsonb then
      raise exception 'Material provider validation evidence' using errcode = '40001';
    end if;
  end loop;
  return jsonb_build_object('tenantId', p_originals->'tenantId', 'invoiceId', invoice->'InvoiceID',
    'paymentId', payment->'PaymentID', 'accountId', account->'AccountID', 'accountCode', account->'Code',
    'accountName', account->'Name', 'paymentDate', day, 'totalCents', total::text);
end $$;

create function public.xero_settled_supplier_evidence_assert_v1(
  p_evidence jsonb, p_evidence_canonical text, p_fingerprint text
) returns void language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
declare observation jsonb; expected jsonb; canonical text;
begin
  if current_user is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence_canonical is null
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or char_length(p_fingerprint) <> 64
    or octet_length(p_evidence_canonical) > 1008192
    or (select count(*) from jsonb_object_keys(p_evidence)) <> 4
    or not(p_evidence ?& array['contract', 'originals', 'observation', 'limits']) then
    raise exception 'Complete bounded ledger evidence envelope required' using errcode = '40001';
  end if;
  observation := public.xero_settled_supplier_snapshot_assert_v1(p_evidence->'originals');
  expected := jsonb_build_object('contract', 'existing_xero_ledger_payment_v1', 'originals', p_evidence->'originals',
    'observation', observation, 'limits', jsonb_build_object(
      'freshnessEstablished', false, 'providerIdentityIndependentlyVerified', false, 'bankRemittanceProven', false,
      'sourcePaymentMatchProven', false, 'sourcePaymentLinkProven', false, 'sourcePaymentPostingProven', false,
      'workflowEligible', false, 'approvalGranted', false, 'financialAuthorityGranted', false));
  if p_evidence is distinct from expected then
    raise exception 'Ledger evidence observation or authority limits changed' using errcode = '40001';
  end if;
  canonical := public.xero_document_correction_canonical_v1(expected);
  if p_evidence_canonical is distinct from canonical
    or p_fingerprint is distinct from public.xero_document_correction_hash_v1(expected)
    or p_fingerprint is distinct from encode(sha256(convert_to(p_evidence_canonical, 'UTF8')), 'hex') then
    raise exception 'Exact original canonical ledger evidence binding changed or unsupported' using errcode = '40001';
  end if;
end $$;

revoke all on function public.xero_settled_supplier_cents_v1(jsonb),
  public.xero_settled_supplier_snapshot_assert_v1(jsonb),
  public.xero_settled_supplier_evidence_assert_v1(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.xero_settled_supplier_cents_v1(jsonb),
  public.xero_settled_supplier_snapshot_assert_v1(jsonb),
  public.xero_settled_supplier_evidence_assert_v1(jsonb, text, text) to service_role;
