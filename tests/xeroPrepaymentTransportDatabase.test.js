import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { xeroFinancialAccountingFetch } from '../api/_xeroFinancialSync.js';
import { executeXeroCreditAllocation, executeXeroPrepayment } from '../api/_xeroPrepaymentExecution.js';
import { xeroNativeDocumentApply, xeroNativeDocumentReconcile } from '../api/_xeroNativeDocumentActions.js';
import { prepareNativeDocumentDraft } from '../api/_xeroNativeDocumentDraft.js';
import { nativeDocumentLedgerFor } from '../api/_xeroNativeDocumentLedger.js';
import { creditAllocationLedgerFor } from '../api/_xeroCreditAllocationLedger.js';
import { prepaymentLedgerFor } from '../api/_xeroPrepaymentLedger.js';
import { createXeroCreditAllocationTransport, createXeroNativeDocumentTransport, createXeroPrepaymentTransport } from '../api/_xeroPrepaymentTransport.js';
import { bindXeroSharedControl, createXeroSharedControl } from '../api/_xeroSharedControl.js';
import { disposableDatabaseUrl, LOCAL_PLATFORM_FIXTURE_SQL } from '../scripts/lib/migration-verification.mjs';
import { fixture, id } from './fixtures/xeroPrepayment.js';

const databaseUrl = process.env.FCOS_PREPAYMENT_TEST_DATABASE_URL;
const tables = new Set(['xero_financial_prepayment_operations', 'xero_financial_credit_allocations', 'xero_native_document_draft_operations', 'xero_shared_budgets', 'xero_shared_requests']);
const functions = new Set([
  'claim_xero_prepayment_operation_v1', 'mark_xero_prepayment_sent_v1', 'finish_xero_prepayment_operation_v1',
  'claim_xero_native_document_draft_v1', 'transition_xero_native_document_draft_v1',
  'claim_xero_credit_allocation_v1', 'transition_xero_credit_allocation_v1',
  'xero_shared_reserve', 'xero_shared_admit', 'xero_shared_observe', 'xero_shared_resolve_unknown', 'xero_shared_release',
]);

function databaseAdapter(db, onRpc) {
  let pendingRead = Promise.resolve();
  return {
    from(table) {
      assert.ok(tables.has(table));
      const conditions = [];
      const values = [];
      const query = {
        select: () => query,
        eq(field, value) {
          assert.match(field, /^[a-z_]+$/);
          values.push(value);
          conditions.push(`${field}=$${values.length}`);
          return query;
        },
        async maybeSingle() {
          assert.equal(conditions.length, table === 'xero_native_document_draft_operations' ? 3 : 2);
          const reading = pendingRead.then(() => db.query(
            `select to_jsonb(row) as data from public.${table} row where ${conditions.join(' and ')}`, values));
          pendingRead = reading.catch(() => {});
          const result = await reading;
          assert.ok(result.rows.length <= 1);
          return { data: result.rows[0]?.data ?? null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.ok(functions.has(name), name);
      const entries = Object.entries(args);
      assert.ok(entries.every(([key]) => /^p_[a-z_]+$/.test(key)));
      const parameters = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
      try {
        const result = await db.query(`select public.${name}(${parameters}) as data`, entries.map(([, value]) => value));
        onRpc(name, args);
        return result.rows[0];
      } catch (error) {
        return { error: { message: error.message, code: error.code } };
      }
    },
  };
}

async function settlementDatabase(t) {
  const endpoint = disposableDatabaseUrl(databaseUrl);
  const owner = new pg.Client({ connectionString: endpoint.toString() });
  await owner.connect();
  const database = `fcos_settlement_${randomUUID().replaceAll('-', '')}`;
  await owner.query(`create database ${database}`);
  endpoint.pathname = `/${database}`;
  const db = new pg.Client({ connectionString: endpoint.toString() });
  const observer = new pg.Client({ connectionString: endpoint.toString() });
  t.after(async () => {
    await Promise.all([db.end(), observer.end()]);
    await owner.query(`drop database ${database} with (force)`);
    await owner.end();
  });
  await db.connect();
  await observer.connect();
  await db.query(LOCAL_PLATFORM_FIXTURE_SQL);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    if (file.startsWith('20261111180108_')) {
      await db.query(`alter default privileges in schema public
        grant maintain, references, trigger, truncate on tables to anon, authenticated, service_role;
        alter default privileges in schema public
        grant all on sequences to anon, authenticated, service_role;`);
    }
    await db.query(await readFile(new URL(file, directory), 'utf8'));
  }
  return { db, observer, files };
}

test('Trading FX journals and policies retain their exact grants under platform defaults',
  { skip: !databaseUrl && 'Requires a disposable local PostgreSQL server' }, async (t) => {
    const { db } = await settlementDatabase(t);
    const tables = [
      'xero_financial_credit_allocations', 'xero_financial_credit_allocation_audit',
      'xero_financial_rounding_policies', 'xero_financial_prepayment_operations',
      'xero_financial_prepayment_operation_audit', 'xero_prepayment_posting_policies',
      'xero_prepayment_posting_policy_history', 'xero_native_document_draft_operations', 'xero_native_document_draft_audit',
    ];
    const grants = (await db.query(`select c.relname,r.role,p.privilege
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join unnest(array['anon','authenticated','service_role']) r(role)
      cross join unnest(array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p(privilege)
      where n.nspname='public' and c.relname=any($1::text[]) and has_table_privilege(r.role,c.oid,p.privilege)
      order by c.relname,r.role,p.privilege`, [tables])).rows;
    const expected = tables.flatMap(relname => (relname === 'xero_financial_rounding_policies' ? ['INSERT','SELECT','UPDATE'] : ['SELECT'])
      .map(privilege => ({ relname, role: 'service_role', privilege }))).sort((left, right) =>
      left.relname.localeCompare(right.relname) || left.privilege.localeCompare(right.privilege));
    assert.deepEqual(grants, expected);
    const sequenceLeaks = await db.query(`select s.relname,r.role,p.privilege
      from pg_depend d join pg_class s on s.oid=d.objid join pg_class c on c.oid=d.refobjid
      join pg_namespace n on n.oid=c.relnamespace
      cross join unnest(array['anon','authenticated','service_role']) r(role)
      cross join unnest(array['SELECT','UPDATE','USAGE']) p(privilege)
      where d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass and d.deptype='i' and s.relkind='S'
      and n.nspname='public' and c.relname=any($1::text[]) and has_sequence_privilege(r.role,s.oid,p.privilege)`, [tables]);
    assert.deepEqual(sequenceLeaks.rows, []);
    await db.query('set role service_role');
    await assert.rejects(db.query('truncate public.xero_prepayment_posting_policy_history'), { code: '42501' });
    assert.equal((await db.query('select count(*) from public.xero_prepayment_posting_policy_history')).rows[0].count, '0');
  });

test('native journal and shared quota recover one original prepayment after expiry and two lost acknowledgements',
  { skip: !databaseUrl && 'Requires a disposable local PostgreSQL server' }, async (t) => {
    const { db, observer, files } = await settlementDatabase(t);
    const source = fixture();
    const tenantId = source.tenantId;
    const actorId = id(90);
    await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token,token_version) values($1,'fixture-only',1)", [tenantId]);
    await db.query('insert into public.xero_shared_tenant_control(tenant_id,allowance_known,available_calls) values($1,true,900)', [tenantId]);
    await db.query('set role service_role');

    const rpcNames = [];
    const adapter = databaseAdapter(db, (name, args) => {
      rpcNames.push(name);
      if (name === 'finish_xero_prepayment_operation_v1' && args.p_status === 'applied') throw new Error('Commit acknowledgement lost');
    });
    const connection = bindXeroSharedControl({ tenantId, tokenVersion: 1, accessToken: 'fixture-only' }, createXeroSharedControl(adapter));
    const ledger = prepaymentLedgerFor(adapter);
    const cashId = 'a02000000000001AAA';
    const body = { operationId: id(70), sourceId: cashId, action: 'create', reviewed: true, reviewFingerprint: 'b'.repeat(64) };
    const review = { sourceId: cashId, cashEventId: cashId, action: 'create', status: 'eligible', currency: 'HKD',
      nativeAmount: 780, accountingUsd: 97.5, sourceFingerprint: 'a'.repeat(64), reviewFingerprint: body.reviewFingerprint,
      proposal: source.operations[0].request_evidence.proposal };
    let providerVisible = false;
    const calls = [];
    const transport = createXeroPrepaymentTransport({
      client: adapter, connection, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
      accountingFetch: (connected, path, options) => xeroFinancialAccountingFetch(connected, path, {
        ...options, requestGate: (_tenant, request) => request(),
      }),
      fetchImpl: async (address, request) => {
        const url = new URL(address);
        assert.equal(url.hostname, 'api.xero.com');
        assert.equal(new Headers(request.headers).get('xero-tenant-id'), tenantId);
        calls.push({ method: request.method, path: url.pathname });
        if (request.method === 'PUT') {
          const operation = await ledger.get({ tenantId, operationId: body.operationId });
          assert.ok(operation.send_started_at);
          assert.equal(new Headers(request.headers).get('idempotency-key'), review.proposal.headers['Idempotency-Key']);
          throw new Error('Synthetic provider response lost');
        }
        if (!providerVisible) return Response.json({ Message: 'Still unavailable' }, { status: 404 });
        if (url.pathname.includes('/BankTransactions')) return Response.json({ BankTransactions: source.xeroBankTransactions });
        assert.match(url.pathname, /\/Prepayments\//);
        return Response.json({ Prepayments: source.xeroPrepayments });
      },
    });
    const options = { ...transport, tenantId, actorId, ledger, loadReview: async () => structuredClone(review) };
    await assert.rejects(executeXeroPrepayment(body, options), { code: 'XERO_PREPAYMENT_UNKNOWN' });
    const original = (await observer.query("select * from public.xero_shared_requests where method='PUT'")).rows[0];
    assert.equal(original.outcome_unknown, true);
    assert.equal((await ledger.get({ tenantId, operationId: body.operationId })).status, 'unknown');
    await observer.query("update public.xero_shared_budgets set expires_at=clock_timestamp()-interval '1 second' where id=$1", [original.budget_id]);
    providerVisible = true;
    const result = await executeXeroPrepayment(body, { ...options, recoveryOnly: true });
    assert.equal(result.status, 'applied');
    assert.equal(result.result.transport.requestId, original.id);
    assert.notEqual(result.result.transport.budgetId, original.budget_id);
    const confirmed = (await observer.query('select * from public.xero_shared_requests where id=$1', [original.id])).rows[0];
    assert.equal(confirmed.outcome_unknown, false);
    assert.equal(confirmed.resolution_request_id, result.result.transport.verificationId);
    const verification = (await observer.query('select * from public.xero_shared_requests where id=$1', [confirmed.resolution_request_id])).rows[0];
    assert.equal(verification.resource_key, 'BankTransactions');
    assert.equal(verification.phase, 'verification');
    assert.equal(verification.method, 'GET');
    assert.equal(verification.budget_id, result.result.transport.budgetId);
    assert.equal((await observer.query("select count(*)::int as count from public.xero_shared_budgets where state='released'")).rows[0].count, 2);
    assert.equal((await executeXeroPrepayment(body, { ...options, recoveryOnly: true })).status, 'applied');
    assert.deepEqual(calls.map((call) => call.method), ['PUT', 'GET', 'GET', 'GET', 'GET']);
    assert.equal(rpcNames.filter((name) => name === 'xero_shared_resolve_unknown').length, 1);
    const journal = await observer.query('select count(*)::int as count from public.xero_financial_prepayment_operation_audit');
    assert.equal(journal.rows[0].count, 4);
    t.diagnostic(`Applied ${files.length} exact migrations with one simulated PUT, four GETs and four journal audit rows`);
  });

test('native full-credit settlement recovers the original send after quota expiry and two lost acknowledgements',
  { skip: !databaseUrl && 'Requires a disposable local PostgreSQL server' }, async (t) => {
    const { db, observer, files } = await settlementDatabase(t);
    const tenantId = id(101);
    const actorId = id(102);
    const creditId = 'a03000000000001AAA';
    const invoiceId = 'a03000000000002AAA';
    const creditMappingId = id(103);
    const invoiceMappingId = id(104);
    const xeroCreditId = id(105);
    const xeroInvoiceId = id(106);
    const allocationId = id(107);
    const contactId = id(108);
    const allocationDate = '2026-09-10';
    const body = { creditId, operationId: id(109), reviewed: true, reviewFingerprint: 'b'.repeat(64) };
    const credit = { CreditNoteID: xeroCreditId, Type: 'ACCRECCREDIT', Status: 'AUTHORISED', CurrencyCode: 'HKD',
      CurrencyRate: 7.8, Total: 780, RemainingCredit: 780, Allocations: [], Contact: { ContactID: contactId } };
    const invoice = { InvoiceID: xeroInvoiceId, Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'HKD',
      CurrencyRate: 7.8, Total: 780, AmountDue: 780, Contact: { ContactID: contactId } };
    const review = {
      creditId, status: 'eligible', action: 'credit_allocate', reviewFingerprint: body.reviewFingerprint,
      creditMappingId, invoiceMappingId, currency: 'HKD', amount: 780, accountingUsd: 100,
      xeroCreditId, xeroInvoiceId, allocationDate, creditRemaining: 780, invoiceAmountDue: 780,
      evidence: { xeroCredit: credit, xeroInvoice: invoice, sourceCredit: 'c'.repeat(64), sourceOriginal: 'd'.repeat(64) },
      proposal: { method: 'PUT', path: `/CreditNotes/${xeroCreditId}/Allocations`,
        payload: { Allocations: [{ Amount: 780, Invoice: { InvoiceID: xeroInvoiceId } }] },
        headers: { 'Idempotency-Key': 'fixture-full-credit' } },
    };
    await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token,token_version) values($1,'fixture-only',1)", [tenantId]);
    await db.query('insert into public.xero_shared_tenant_control(tenant_id,allowance_known,available_calls) values($1,true,900)', [tenantId]);
    await db.query(`insert into public.xero_financial_document_mappings
      (id,salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,source_fingerprint,financial_fingerprint)
      values ($1,'Invoice__c',$2,'CN-1','buyer_credit','ACCRECCREDIT',$3,$4,$4),
             ($5,'Invoice__c',$6,'INV-1','buyer_invoice','ACCREC',$7,$8,$8)`,
    [creditMappingId, creditId, xeroCreditId, review.evidence.sourceCredit,
      invoiceMappingId, invoiceId, xeroInvoiceId, review.evidence.sourceOriginal]);
    await db.query('set role service_role');
    const rpcNames = [];
    const adapter = databaseAdapter(db, (name, args) => {
      rpcNames.push(name);
      if (name === 'transition_xero_credit_allocation_v1' && args.p_transition === 'applied') {
        throw new Error('Synthetic commit acknowledgement lost');
      }
    });
    const connection = bindXeroSharedControl({ tenantId, tokenVersion: 1, accessToken: 'fixture-only' }, createXeroSharedControl(adapter));
    const ledger = creditAllocationLedgerFor(adapter, actorId);
    let providerVisible = false;
    const calls = [];
    const transport = createXeroCreditAllocationTransport({
      client: adapter, connection, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
      accountingFetch: (connected, path, options) => xeroFinancialAccountingFetch(connected, path, {
        ...options, requestGate: (_tenant, request) => request(),
      }),
      fetchImpl: async (address, request) => {
        const url = new URL(address);
        const headers = new Headers(request.headers);
        assert.equal(url.hostname, 'api.xero.com');
        assert.equal(headers.get('xero-tenant-id'), tenantId);
        calls.push([request.method, url.pathname]);
        if (request.method === 'PUT') {
          const sent = await ledger.get({ tenantId, operationId: body.operationId });
          assert.ok(sent.send_started_at);
          assert.equal(headers.get('idempotency-key'), review.proposal.headers['Idempotency-Key']);
          assert.deepEqual(JSON.parse(request.body), review.proposal.payload);
          throw new Error('Synthetic provider response lost');
        }
        if (!providerVisible) return Response.json({ Message: 'Still unavailable' }, { status: 404 });
        if (url.pathname.endsWith(`/CreditNotes/${xeroCreditId}`)) {
          return Response.json({ CreditNotes: [{ ...credit, RemainingCredit: 0,
            Allocations: [{ AllocationId: allocationId, Amount: 780, Date: allocationDate, Invoice: { InvoiceID: xeroInvoiceId } }] }] });
        }
        assert.ok(url.pathname.endsWith(`/Invoices/${xeroInvoiceId}`));
        return Response.json({ Invoices: [{ ...invoice, AmountDue: 0 }] });
      },
    });
    const options = { ...transport, tenantId, actorId, ledger, loadReview: async () => structuredClone(review) };
    await assert.rejects(executeXeroCreditAllocation(body, options), { code: 'XERO_CREDIT_ALLOCATION_UNKNOWN' });
    const original = (await observer.query("select * from public.xero_shared_requests where method='PUT'")).rows[0];
    assert.equal(original.outcome_unknown, true);
    assert.equal((await ledger.get({ tenantId, operationId: body.operationId })).status, 'unknown');
    await observer.query("update public.xero_shared_budgets set expires_at=clock_timestamp()-interval '1 second' where id=$1", [original.budget_id]);
    providerVisible = true;

    const result = await executeXeroCreditAllocation(body, { ...options, recoveryOnly: true });
    assert.equal(result.status, 'applied');
    assert.equal(result.result.allocationId, allocationId);
    assert.equal(result.result.transport.requestId, original.id);
    assert.notEqual(result.result.transport.budgetId, original.budget_id);
    const confirmed = (await observer.query('select * from public.xero_shared_requests where id=$1', [original.id])).rows[0];
    assert.equal(confirmed.outcome_unknown, false);
    assert.equal(confirmed.resolution_request_id, result.result.transport.verificationId);
    const verification = (await observer.query('select * from public.xero_shared_requests where id=$1', [confirmed.resolution_request_id])).rows[0];
    assert.deepEqual([verification.method, verification.resource_key, verification.phase], ['GET', 'CreditNotes', 'verification']);
    assert.equal((await observer.query("select count(*)::int as count from public.xero_shared_budgets where state='released'")).rows[0].count, 2);
    assert.equal((await executeXeroCreditAllocation(body, { ...options, recoveryOnly: true })).status, 'applied');
    assert.deepEqual(calls.map(call => call[0]), ['PUT', 'GET', 'GET', 'GET']);
    assert.equal(rpcNames.filter(name => name === 'xero_shared_resolve_unknown').length, 1);
    const journal = await observer.query('select count(*)::int as count from public.xero_financial_credit_allocation_audit');
    assert.equal(journal.rows[0].count, 4);
    t.diagnostic(`Applied ${files.length} exact migrations with one simulated PUT, three GETs and four journal audit rows`);
  });

test('native document journal admits one send and atomically confirms its exact draft mapping',
  { skip: !databaseUrl && 'Requires a disposable local PostgreSQL server' }, async (t) => {
    const { db, observer, files } = await settlementDatabase(t);
    const tenantId = id(201);
    const actorId = id(202);
    const operationId = id(203);
    const xeroId = id(204);
    const contactId = id(205);
    const sourceId = 'a06000000000001AAA';
    const requestHash = 'a'.repeat(64);
    const reviewFingerprint = 'b'.repeat(64);
    const sourceFingerprint = 'c'.repeat(64);
    const payload = { Type: 'ACCREC', Status: 'DRAFT', InvoiceNumber: 'INV-100', Contact: { ContactID: contactId },
      Date: '2026-09-10', CurrencyCode: 'HKD', CurrencyRate: 7.8,
      LineItems: [{ Description: 'INVOICE 10/9/2026', Quantity: 1, UnitAmount: 780, AccountCode: '41100', TaxType: 'NONE' }] };
    const review = { tenantId, sourceId, sourceObject: 'Invoice__c', sourceFingerprint, accountingUsd: 100, nativeTotal: 780,
      draft: { status: 'draft_preview', reviewFingerprint, xeroCollection: 'Invoices', payload } };
    const mapping = { salesforce_object: 'Invoice__c', salesforce_id: sourceId, salesforce_document_number: 'INV-100',
      document_kind: 'buyer_invoice', xero_document_type: 'ACCREC', xero_document_id: xeroId, xero_document_number: 'INV-100',
      xero_contact_id: contactId, xero_status: 'DRAFT', source_fingerprint: sourceFingerprint,
      financial_fingerprint: 'd'.repeat(64), protected_legacy: false, retained_differences: { reviewFingerprint },
      currency: 'HKD', accounting_usd: 100, company_fx_rate: 7.8, company_fx_revision: 'fixture-rate',
      currency_evidence: { documentCurrency: 'HKD', rateRevision: 'fixture-rate', nativeAmount: 780, originalLines: [{ snapshotId: 'fixture' }] },
      xero_currency_rate: 7.8 };
    const observed = { ...payload, InvoiceID: xeroId, Total: 780, SubTotal: 780, TotalTax: 0, LineAmountTypes: 'NoTax' };
    await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token,token_version) values($1,'fixture-only',1)", [tenantId]);
    await db.query('set role service_role');
    const claim = async (idValue = operationId, input = review) => (await db.query(
      'select public.claim_xero_native_document_draft_v1($1,$2,$3,$4,$5) as result', [idValue, tenantId, actorId, requestHash, input])).rows[0].result;
    const transition = async (phase, target = null, data = null, proof = null, actor = actorId) => (await db.query(
      'select public.transition_xero_native_document_draft_v1($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [operationId, tenantId, actor, requestHash, phase, target, data, proof])).rows[0].result;
    const ledger = nativeDocumentLedgerFor(databaseAdapter(db, () => {}), actorId);
    const key = { operationId, tenantId, requestHash };
    assert.equal((await ledger.claim({ ...key, review })).claimed, true);
    assert.equal((await claim()).claimed, false);
    assert.equal((await ledger.get(key)).status, 'intent');
    await assert.rejects(claim(id(207), { ...review, sourceId: sourceId.slice(0, 15) }), { code: '40001' });
    await assert.rejects(claim(id(208), { ...review, sourceId: 'a06000000000002AAA' }), { code: '40001' });
    await assert.rejects(db.query("update public.xero_native_document_draft_operations set status='sent'"), { code: '42501' });
    await assert.rejects(transition('mark_sent', null, null, null, id(209)), { code: '40001' });
    assert.equal((await ledger.markSent(key)).changed, true);
    assert.equal((await transition('mark_sent')).changed, false);
    await transition('unknown');
    await assert.rejects(transition('confirmed', xeroId, mapping, observed), { code: '40001' });
    await transition('observe_id', xeroId);
    await assert.rejects(transition('observe_id', id(206)), { code: '40001' });
    await assert.rejects(transition('confirmed', xeroId, { ...mapping, accounting_usd: 101 }, observed), { code: '22023' });
    await assert.rejects(transition('confirmed', xeroId, mapping, { ...observed,
      LineItems: [{ ...observed.LineItems[0], AccountCode: '50000' }] }), { code: '22023' });
    assert.equal((await observer.query('select count(*)::int as total from public.xero_financial_document_mappings')).rows[0].total, 0);
    const confirmation = await ledger.confirm(key, { xeroId, mapping, observed });
    assert.equal(confirmation.operation.status, 'confirmed');
    const linked = (await observer.query('select id,xero_document_id from public.xero_financial_document_mappings')).rows;
    assert.deepEqual(linked, [{ id: confirmation.operation.mapping_id, xero_document_id: xeroId }]);
    assert.equal((await transition('confirmed', xeroId, mapping, observed)).changed, false);
    await assert.rejects(transition('confirmed', xeroId, { ...mapping, accounting_usd: 101 }, observed), { code: '40001' });
    const audited = (await observer.query('select status from public.xero_native_document_draft_audit order by id')).rows.map(row => row.status);
    assert.deepEqual(audited, ['intent', 'sent', 'unknown', 'unknown', 'confirmed']);
    t.diagnostic(`Applied ${files.length} exact migrations; one send marker, one confirmed mapping and five journal events`);
  });

test('native draft transport confirms an original acknowledged Xero ID with read-only recovery',
  { skip: !databaseUrl && 'Requires a disposable local PostgreSQL server' }, async (t) => {
    const { db, observer, files } = await settlementDatabase(t);
    const tenantId = id(301);
    const actorId = id(302);
    const operationId = id(303);
    const xeroId = id(304);
    const contactId = id(305);
    const sourceId = 'a06000000000001AAA';
    const accountId = '001000000000001AAA';
    const source = {
      record: { Id: sourceId, Name: 'INV-300', Amount__c: 100, STEM__c: 'a00000000000001AAA', STEM__r: { Account__c: accountId },
        Document_FX_Rate__c: 7.8, Document_FX_Revision__c: 'fixture-rate', Document_FX_Confirmed_At__c: '2026-09-10T00:00:00Z' },
      sourceFingerprint: 'a'.repeat(64), signedTotal: 780, currency: 'HKD',
      lines: [{ sourceId, description: 'Fuel', quantity: 10, unitAmount: 78, accountCode: '41100', taxType: 'NONE',
        originalPriceEvidence: { currency: 'HKD', snapshotId: 'fixture-line', nativeAmount: 780 } }],
    };
    const sourceObject = 'Invoice__c';
    const draft = prepareNativeDocumentDraft({ ...source, sourceObject, tenantId, organisationCurrency: 'USD', xeroCurrencyRate: 7.8,
      invoiceDate: '2026-09-10', dueDate: '2026-09-25',
      xeroReview: { status: 'no_exact_number_match', ownershipVerified: true, contact: { id: contactId } } });
    const review = { tenantId, sourceObject, sourceId, sourceFingerprint: source.sourceFingerprint,
      accountingUsd: 100, nativeTotal: 780, source, draft };
    const observed = { ...draft.payload, InvoiceID: xeroId, Total: 780, SubTotal: 780, TotalTax: 0,
      LineItems: [{ ...draft.payload.LineItems[0], LineAmount: 780 }] };
    await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token,token_version) values($1,'fixture-only',1)", [tenantId]);
    await db.query('insert into public.xero_shared_tenant_control(tenant_id,allowance_known,available_calls) values($1,true,900)', [tenantId]);
    await db.query('set role service_role');
    const adapter = databaseAdapter(db, (name, args) => {
      if (name === 'transition_xero_native_document_draft_v1' && ['observe_id', 'confirmed'].includes(args.p_transition)) {
        throw new Error('Synthetic journal acknowledgement loss');
      }
    });
    const connection = bindXeroSharedControl({ tenantId, tokenVersion: 1, accessToken: 'fixture-only', scope: 'accounting.invoices' }, createXeroSharedControl(adapter));
    const ledger = nativeDocumentLedgerFor(adapter, actorId);
    const calls = [];
    let visible = false;
    let losePostResponse = false;
    const transportFor = dependencies => createXeroNativeDocumentTransport({
      ...dependencies,
      accountingFetch: (connected, path, options) => xeroFinancialAccountingFetch(connected, path, {
        ...options, requestGate: (_tenant, request) => request(),
      }),
      fetchImpl: async (address, request) => {
        const url = new URL(address);
        const headers = new Headers(request.headers);
        assert.equal(url.hostname, 'api.xero.com');
        assert.equal(headers.get('xero-tenant-id'), tenantId);
        assert.equal(url.searchParams.get('unitdp'), '4');
        calls.push([request.method, url.pathname]);
        if (request.method === 'POST') {
          assert.match(headers.get('idempotency-key'), /^fcos-native-/);
          if (losePostResponse) throw new Error('Synthetic loss before the original provider ID was received');
          assert.deepEqual(JSON.parse(request.body), { Invoices: [draft.payload] });
          return Response.json({ Invoices: [observed] });
        }
        assert.equal(url.pathname, `/api.xro/2.0/Invoices/${xeroId}`);
        return visible ? Response.json({ Invoices: [observed] }) : Response.json({}, { status: 404 });
      },
    });
    const options = { client: adapter, accessContext: { profile: { id: actorId } }, getConnection: async () => connection,
      env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, transportFor, readReview: async () => ({ privateReview: structuredClone(review) }) };
    const body = { operationId, tenantId, sourceId, sourceObject, reviewed: true, reviewFingerprint: draft.reviewFingerprint };
    await assert.rejects(xeroNativeDocumentApply(body, options), { code: 'XERO_NATIVE_DOCUMENT_UNKNOWN' });
    const original = await ledger.get({ operationId, tenantId });
    assert.equal(original.status, 'unknown');
    assert.equal(original.observed_xero_id, xeroId);
    visible = true;
    const recovery = { ...options, env: {}, readReview: () => assert.fail('recovery must not rebuild a proposal') };
    const confirmed = await xeroNativeDocumentReconcile(body, recovery);
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.xeroId, xeroId);
    assert.deepEqual(await xeroNativeDocumentReconcile(body, recovery), confirmed);
    assert.deepEqual(calls.map(call => call[0]), ['POST', 'GET', 'GET']);
    const saved = await ledger.get({ operationId, tenantId });
    assert.equal(saved.mapping_id, confirmed.mappingId);
    const receipts = await observer.query("select state from public.xero_shared_budgets order by created_at");
    assert.deepEqual(receipts.rows.map(row => row.state), ['released', 'released']);

    const secondSource = { ...source, record: { ...source.record, Id: 'a06000000000002AAA', Name: 'INV-301' } };
    const secondDraft = prepareNativeDocumentDraft({ ...secondSource, sourceObject, tenantId, organisationCurrency: 'USD',
      xeroCurrencyRate: 7.8, invoiceDate: '2026-09-10', dueDate: '2026-09-25',
      xeroReview: { status: 'no_exact_number_match', ownershipVerified: true, contact: { id: contactId } } });
    const second = { ...body, operationId: id(306), sourceId: secondSource.record.Id, reviewFingerprint: secondDraft.reviewFingerprint };
    losePostResponse = true;
    await assert.rejects(xeroNativeDocumentApply(second, { ...options, readReview: async () => ({ privateReview: {
      ...review, sourceId: second.sourceId, source: secondSource, draft: secondDraft,
    } }) }), { code: 'XERO_NATIVE_DOCUMENT_UNKNOWN' });
    await assert.rejects(xeroNativeDocumentReconcile(second, recovery), { code: 'XERO_NATIVE_DOCUMENT_UNKNOWN' });
    assert.equal((await ledger.get({ operationId: second.operationId, tenantId })).observed_xero_id, null);
    assert.deepEqual(calls.map(call => call[0]), ['POST', 'GET', 'GET', 'POST']);
    t.diagnostic(`Applied ${files.length} exact migrations; two independent original POSTs, one confirmed mapping and zero replay POSTs`);
  });
