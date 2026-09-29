import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { bindXeroSharedControl, runWithXeroBudget } from '../api/_xeroSharedControl.js';
import { xeroAccountingFetch } from '../api/_xeroContactSync.js';
import { fixtureSharedControl } from './helpers/xeroSharedControl.js';
import { resolveGroupRemittanceBankEvidence } from '../api/_xeroGroupRemittanceBankEvidence.js';
import { executeCampaignBatch } from '../api/_xeroReconciliationExecution.js';
import { buildXeroAccountingPayload, toSyncItemRow } from '../api/_xeroFinancialSync.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const connection = { tenantId };
const xero = { id: 'xero-one', type: 'ACCREC', collection: 'Invoices', status: 'AUTHORISED',
  invoiceNumber: 'INV-1', contactId: 'contact-one', contactName: 'Buyer', currency: 'USD',
  date: '2026-09-01', dueDate: '2026-09-30', total: 100, amountDue: 100, amountPaid: 0,
  amountCredited: 0, lineItems: [], updatedDateUTC: '2026-09-30T00:00:00Z' };
const raw = { InvoiceID: 'xero-one', Type: 'ACCREC', Status: 'AUTHORISED', InvoiceNumber: 'INV-1',
  Contact: { ContactID: 'contact-one', Name: 'Buyer' }, CurrencyCode: 'USD', Total: 100,
  AmountDue: 100, AmountPaid: 0, AmountCredited: 0, LineItems: [], UpdatedDateUTC: '2026-09-30T00:00:00Z' };
const source = { salesforceObject: 'Invoice__c', salesforceId: 'invoice-one', documentNumber: 'INV-1',
  documentKind: 'buyer', xeroType: 'ACCREC', xeroCollection: 'Invoices', accountId: 'account-one',
  contactId: 'contact-one', currency: 'USD', total: 100, stemId: 'stem-one', sourceFingerprint: 'source-v1',
  financialFingerprint: 'financial-v1', postingMode: 'draft', blockers: [], warnings: [], differences: [],
  reviewRequired: false, acceptedLegacy: false };
const classified = { ...source, action: 'link', status: 'eligible', xero, proposedPayload: {} };
const item = toSyncItemRow(classified, 'run-one', 0, '2026-09-30T00:00:00Z');
const inventory = { complete: true, contactsComplete: true, tenantId, observedSince: '2026-09-30T00:00:00Z',
  documents: [xero], inactiveDocuments: [], contacts: [{ id: 'contact-one', name: 'Buyer', status: 'ACTIVE' }],
  organisation: { baseCurrency: 'USD' }, paymentReadSnapshot: { invoices: [raw], payments: [] } };
const run = { id: 'run-one', control_totals: { postingMode: 'draft', workflowSnapshot: { complete: true,
  linkFirst: true, inventory } } };
const campaign = { id: 'campaign-one', run_id: run.id, tenant_id: tenantId };
const batch = { id: 'batch-one', claim_id: 'claim-one', category: 'link_only',
  forecast: { readCalls: 8, recoveryCalls: 2, otherActivityCalls: 2, verificationCalls: 1 } };
const caseRow = { id: `${tenantId}:Invoice__c:invoice-one`, caseKey: `${tenantId}:Invoice__c:invoice-one`,
  sourceObject: 'Invoice__c', sourceId: 'invoice-one', targetId: 'xero-one', category: 'link_only',
  status: 'ready', evidenceFingerprint: 'a'.repeat(64) };

function fixture(options = {}) {
  const calls = [];
  const client = {
    from(table) {
      let rows = table === 'xero_financial_sync_runs' ? [options.run || run] : table === 'xero_financial_sync_items' ? [options.item || item] : [];
      const chain = {
        select() { return chain; }, eq(key, value) { rows = rows.filter((row) => row[key] === value); return chain; },
        order(key) { rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]))); return chain; },
        async maybeSingle() { return { data: rows[0] || null, error: null }; },
        async range(start, end) { return { data: rows.slice(start, end + 1), error: null }; },
      };
      return chain;
    },
  };
  return { calls, dependencies: { client, connection, campaign, batch, cases: [caseRow], actor: { id: 'user-one' },
    loadSalesforce: async () => ({ groupedAccountSnapshot: { complete: true, accounts: [] } }),
    loadControls: async () => ({ documentMappings: options.documentMappings || [] }),
    refreshInventory: async () => ({ ...inventory, rawTargets: { invoices: [raw], creditNotes: [] },
      missingTargetIds: { invoices: [], creditNotes: [] } }),
    classify: () => ({ rows: [{ ...classified, ...(options.fresh || {}) }] }),
    reserveBudget: async (_connection, request) => { calls.push({ type: 'reserve', request }); return { id: 'budget-one' }; },
    withBudget: async (_connection, scope, work) => { calls.push({ type: 'scope', scope }); return work(); },
    releaseBudget: async (_connection, request) => { calls.push({ type: 'release', request }); },
    persistInventory: async (request) => { calls.push({ type: 'inventory', request }); return { data: { saved: true } }; },
    accountingFetch: async (_connection, path, options) => { calls.push({ type: 'provider', path, options });
      return { Invoices: [{ ...raw, ...(options.verifyChange || {}) }] }; },
  } };
}

test('verified document link returns exact mapping proof with zero Xero writes', async () => {
  const f = fixture();
  const outcomes = await executeCampaignBatch(f.dependencies);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, 'reconciled');
  assert.equal(outcomes[0].mapping.salesforce_id, 'invoice-one');
  assert.equal(outcomes[0].mapping.xero_document_id, 'xero-one');
  assert.equal(outcomes[0].mapping.protected_legacy, true);
  assert.match(outcomes[0].verificationFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.calls.filter((row) => row.type === 'provider').map((row) => row.options.method), ['GET']);
  assert.equal(f.calls.find((row) => row.type === 'scope' && row.scope.budgetPhase === 'verification')?.scope.budgetId, 'budget-one');
  assert.equal(f.calls.filter((row) => row.type === 'inventory').length, 1);
  assert.equal(f.calls.filter((row) => row.type === 'release').length, 1);
});

test('changed source fingerprint is held independently without a verification call', async () => {
  const f = fixture({ fresh: { sourceFingerprint: 'source-v2' } });
  const outcomes = await executeCampaignBatch(f.dependencies);
  assert.equal(outcomes[0].status, 'needs_decision');
  assert.match(outcomes[0].reason, /changed/);
  assert.equal(f.calls.filter((row) => row.type === 'provider').length, 0);
});

test('second exact readback detects settlement drift and does not claim reconciliation', async () => {
  const f = fixture();
  f.dependencies.accountingFetch = async (_connection, path, options) => {
    f.calls.push({ type: 'provider', path, options });
    return { Invoices: [{ ...raw, AmountDue: 80, AmountPaid: 20, Payments: [{ PaymentID: 'new-payment', Amount: 20 }] }] };
  };
  const outcomes = await executeCampaignBatch(f.dependencies);
  assert.equal(outcomes[0].status, 'needs_decision');
  assert.match(outcomes[0].reason, /changed/);
});

test('draft claims require a complete recovery verification allowance', async () => {
  const f = fixture();
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, batch: { ...batch, category: 'draft' },
    cases: [{ ...caseRow, category: 'draft' }] }), /approved Xero call budget is incomplete/);
  assert.equal(f.calls.filter((row) => row.type === 'provider').length, 0);
});

test('ordinary existing payment link requires fresh classification and exact payment plus invoice readback', async () => {
  const saved = { salesforcePaymentId: 'payment-one', salesforcePaymentName: 'PAY-1', action: 'payment_link',
    status: 'eligible', blockers: [], sourceFingerprint: 'source-payment-v1', reviewFingerprint: 'review-payment-v1',
    documentMappingId: 'mapping-one', xeroDocumentId: 'xero-one', bankAccountId: 'bank-one', xeroPaymentId: 'payment-xero-one', amount: 20, currency: 'USD',
    paymentDate: '2026-09-01', confirmedPayment: { confirmed_reference: 'PAY-1' } };
  const rawPayment = { PaymentID: 'payment-xero-one', Amount: 20, Status: 'AUTHORISED',
    Invoice: { InvoiceID: 'xero-one', CurrencyCode: 'USD' }, Account: { AccountID: 'bank-one' },
    Reference: 'PAY-1', Date: '2026-09-01' };
  const paymentInvoice = { ...raw, AmountDue: 80, AmountPaid: 20, Payments: [{ PaymentID: rawPayment.PaymentID, Amount: 20 }] };
  const savedRun = { ...run, control_totals: { ...run.control_totals,
    workflowSnapshot: { ...run.control_totals.workflowSnapshot, payments: { rows: [saved] } } } };
  const f = fixture({ run: savedRun, documentMappings: [{ id: 'mapping-one', xero_document_id: 'xero-one',
    xero_contact_id: 'contact-one' }] });
  const paymentCase = { ...caseRow, id: `${tenantId}:Payment__c:payment-one`, sourceObject: 'Payment__c',
    sourceId: 'payment-one', targetId: 'payment-xero-one' };
  f.dependencies.refreshInventory = async () => ({ ...inventory, rawTargets: { invoices: [paymentInvoice], creditNotes: [] },
    paymentReadSnapshot: { ...inventory.paymentReadSnapshot, payments: [rawPayment] } });
  f.dependencies.loadPayments = async () => [{ Id: 'payment-one' }];
  f.dependencies.classifyPayments = async () => ({ tenantId, rows: [{ ...saved }] });
  f.dependencies.accountingFetch = async (_connection, path, options) => {
    f.calls.push({ type: 'provider', path, options });
    return path.startsWith('/Payments/') ? { Payments: [rawPayment] } : { Invoices: [paymentInvoice] };
  };
  const outcomes = await executeCampaignBatch({ ...f.dependencies,
    batch: { ...batch, forecast: { ...batch.forecast, verificationCalls: 2 } }, cases: [paymentCase] });
  assert.equal(outcomes[0].status, 'reconciled');
  assert.equal(outcomes[0].paymentMapping.xero_payment_id, 'payment-xero-one');
  assert.equal(outcomes[0].paymentEvidence.reviewFingerprint, 'review-payment-v1');
  assert.deepEqual(f.calls.filter((row) => row.type === 'provider').map((row) => row.path),
    ['/Payments/payment-xero-one', '/Invoices?IDs=xero-one&summaryOnly=false&unitdp=4']);
});

test('payment claim fails closed when its verification allowance covers only one read', async () => {
  const f = fixture();
  const paymentCase = { ...caseRow, id: `${tenantId}:Payment__c:payment-one`, sourceObject: 'Payment__c',
    sourceId: 'payment-one', targetId: 'payment-xero-one' };
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, cases: [paymentCase] }),
    /approved Xero call budget is incomplete/);
  assert.equal(f.calls.filter((row) => row.type === 'provider').length, 0);
});

test('invalid shared budget stops before provider reads', async () => {
  const f = fixture();
  f.dependencies.reserveBudget = async () => { throw new Error('shared allowance unavailable'); };
  await assert.rejects(executeCampaignBatch(f.dependencies), /shared allowance unavailable/);
  assert.equal(f.calls.filter((row) => row.type === 'provider').length, 0);
});

test('contact claim uses its original verified receipt and refreshes complete inventory', async () => {
  const f = fixture();
  const contactCase = { ...caseRow, id: `${tenantId}:Account:account-one`, sourceObject: 'Account',
    sourceId: '001000000000001AAA', sourceIds: ['001000000000001AAA'], category: 'contact', targetId: null,
    ownerId: '22222222-2222-4222-8222-222222222222', baselineAt: '2026-09-30T00:00:00Z' };
  const batchContact = { ...batch, category: 'contact', forecast: { ...batch.forecast,
    writeCalls: 1, verificationCalls: 2 } };
  f.dependencies.loadSalesforce = async () => ({ groupedAccountSnapshot: { complete: true,
    accounts: [{ id: '001000000000001AAA', name: 'Buyer Company', inactiveSuspended: false, recordType: 'Buyer' }] } });
  let inventoryReads = 0;
  f.dependencies.refreshInventory = async (args) => {
    inventoryReads += 1;
    f.calls.push({ type: 'refresh', args });
    return { ...inventory, contacts: inventoryReads === 1 ? [] : args.inventory.contacts, rawTargets: { invoices: [], creditNotes: [] } };
  };
  f.dependencies.executeContact = async (args) => {
    f.calls.push({ type: 'contact', args });
    return { caseId: contactCase.id, evidenceFingerprint: contactCase.evidenceFingerprint,
      status: 'reconciled', receiptId: 'original-audit-id', verificationFingerprint: 'b'.repeat(64),
      verifiedContact: { id: '33333333-3333-4333-8333-333333333333', name: 'Buyer Company', status: 'ACTIVE' },
      sourceIds: contactCase.sourceIds };
  };
  const outcomes = await executeCampaignBatch({ ...f.dependencies, batch: batchContact, cases: [contactCase] });
  assert.equal(outcomes[0].receiptId, 'original-audit-id');
  assert.equal(inventoryReads, 2);
  assert.equal(f.calls.filter((row) => row.type === 'inventory').length, 2);
  assert.equal(f.calls.filter((row) => row.type === 'release').length, 1);
  assert.equal(f.calls.find((row) => row.type === 'reserve').request.operationCalls, 13);
});

test('uncertain Contact operation leaves its shared reservation for readback', async () => {
  const f = fixture();
  const contactCase = { ...caseRow, id: `${tenantId}:Account:account-one`, sourceObject: 'Account',
    sourceId: '001000000000001AAA', sourceIds: ['001000000000001AAA'], category: 'contact', targetId: null,
    ownerId: '22222222-2222-4222-8222-222222222222', baselineAt: '2026-09-30T00:00:00Z' };
  f.dependencies.executeContact = async () => { throw new Error('Contact outcome unknown'); };
  await assert.rejects(executeCampaignBatch({ ...f.dependencies,
    batch: { ...batch, category: 'contact', forecast: { ...batch.forecast, writeCalls: 1, verificationCalls: 2 } },
    cases: [contactCase] }), /Contact outcome unknown/);
  assert.equal(f.calls.filter((row) => row.type === 'release').length, 0);
});

function draftFixture(options = {}) {
  const f = fixture();
  const draftSource = { ...source, xero: undefined, action: 'create_draft', status: 'eligible',
    ...(options.supplier ? { salesforceObject: 'Supplier_Invoice__c', salesforceId: 'supplier-one', documentKind: 'supplier',
      xeroType: 'ACCPAY', contactId: '77777777-7777-4777-8777-777777777777', documentNumber: 'HK2626001T-VESSEL' } : {}),
    invoiceDate: '2026-09-01', dueDate: '2026-09-30', reference: 'STEM-1',
    lines: [{ description: 'Fuel', quantity: 1, unitAmount: 100, accountCode: '200', taxType: 'NONE' }] };
  const payload = buildXeroAccountingPayload(draftSource);
  const current = { ...draftSource, proposedPayload: payload };
  const savedItem = toSyncItemRow(current, run.id, 0, '2026-09-30T00:00:00Z');
  const draftCase = { ...caseRow, id: `${tenantId}:${draftSource.salesforceObject}:${draftSource.salesforceId}`,
    sourceObject: draftSource.salesforceObject, sourceId: draftSource.salesforceId, targetId: null, category: 'draft' };
  const currentBatch = { ...batch, category: 'draft', campaign_id: campaign.id, status: 'running',
    claim_case_ids: [draftCase.id], approved_by: 'user-one', approved_at: '2026-09-30T00:00:00Z',
    forecast: { ...batch.forecast, writeCalls: 1, verificationCalls: 2 } };
  const target = { ...raw, ...payload, InvoiceID: '33333333-3333-4333-8333-333333333333',
    LineItems: payload.LineItems.map((line) => ({ ...line, LineItemID: 'line-one', TaxAmount: 0 })) };
  const events = [];
  const tables = { xero_financial_sync_runs: [run], xero_financial_sync_items: [savedItem],
    xero_reconciliation_batches: [currentBatch], xero_reconciliation_campaigns: [campaign],
    xero_reconciliation_cases: [{ id: draftCase.id, campaign_id: campaign.id, evidence_fingerprint: draftCase.evidenceFingerprint }],
    xero_financial_audit_events: events, xero_shared_budgets: [], xero_shared_requests: [], xero_reconciliation_events: [] };
  const client = {
    from(table) {
      let rows = [...(tables[table] || [])];
      let queryError = null;
      const chain = {
        select() { return chain; },
        eq(key, value) { rows = rows.filter((row) => key.includes('->>')
          ? row[key.split('->>')[0]]?.[key.split('->>')[1]] === value : row[key] === value); return chain; },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return chain; },
        order() { return chain; }, limit(max) { rows = rows.slice(0, max); return chain; },
        async range(start, end) { return { data: rows.slice(start, end + 1), error: null }; },
        async maybeSingle() { return { data: rows[0] || null, error: queryError }; },
        then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
        insert(row) {
          f.calls.push({ type: 'journal', row });
          if (options.auditFailure === row.event_type) queryError = { code: 'storage-error' };
          else { const saved = { ...row, id: String(events.length + 1) }; tables[table].push(saved); rows = [saved]; }
          return chain;
        },
      };
      return chain;
    },
    async rpc(name, args) { f.calls.push({ type: 'rpc', name, args }); return { data: true, error: null }; },
  };
  let posts = 0;
  let targetExists = false;
  f.dependencies = { ...f.dependencies, client, cases: [draftCase], batch: currentBatch,
    connection: bindXeroSharedControl({ tenantId, scope: 'accounting.invoices', tokenVersion: 1 }, {resolveUnknown: async () => true}), env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
    reserveBudget: async (_connection, request) => {
      const budget = { id: tables.xero_shared_budgets.length ? `budget-${tables.xero_shared_budgets.length+1}` : 'budget-one', tenant_id: tenantId, owner_key: request.ownerKey, state: 'active',
        operation_remaining: request.operationCalls, verification_remaining: request.verificationCalls,
        expires_at: new Date(Date.now()+600000).toISOString() };
      tables.xero_shared_budgets.push(budget);f.calls.push({type:'reserve',request});return budget;
    },
    classify: () => ({ rows: [{ ...current, ...(options.sourceDrift || {}) }] }),
    accountingFetch: async (_connection, path, request) => {
      f.calls.push({ type: 'provider', path, options: request });
      if (request.method === 'POST') {
        posts += 1; targetExists = true;
        const intent=events.filter(row=>row.event_type==='campaign_document_intent').at(-1).fingerprints;
        assert.equal(request.requestId,intent.postRequestId);
        tables.xero_shared_requests.push({id:request.requestId,tenant_id:tenantId,budget_id:intent.postBudgetId,token_version:1,
          resource_key:'Invoices',method:'POST',phase:'operation',state:options.unknownPost?'unknown':'complete',outcome_unknown:Boolean(options.unknownPost),
          deadline_at:new Date(Date.now()-1000).toISOString()});
        assert.equal(events.filter((row) => row.event_type === 'campaign_document_intent').at(-1).fingerprints.proposedPayload.InvoiceNumber,
          request.body.Invoices[0].InvoiceNumber);
        if (options.unknownPost) throw new Error('Network response lost');
        request.onResponse?.({status:200,requestId:request.requestId,budgetId:intent.postBudgetId});
        return { Invoices: [{ ...target, ...(options.postDrift || {}) }] };
      }
      request.onResponse?.({status:200,requestId:randomUUID(),budgetId:'budget-one'});
      if (path.includes('?where=')) return { Invoices: targetExists || options.existingTarget ? [target] : [] };
      return { Invoices: [{ ...target, ...(options.readbackDrift || {}) }] };
    },
  };
  return { ...f, draftCase, target, events, tables, get posts() { return posts; } };
}

test('draft executor journals intent before POST and yields verified original mapping for atomic finish', async () => {
  const f = draftFixture();
  const [outcome] = await executeCampaignBatch(f.dependencies);
  assert.equal(outcome.status, 'reconciled');
  assert.equal(outcome.mapping.protected_legacy, false);
  assert.equal(outcome.mapping.xero_status, 'DRAFT');
  assert.equal(outcome.mapping.xero_document_id, f.target.InvoiceID);
  assert.equal(f.posts, 1);
  assert.deepEqual(f.events.map((row) => row.event_type),
    ['campaign_document_intent', 'campaign_document_response', 'campaign_document_verified']);
  const proof = f.events.find((row) => row.id === outcome.receiptId).fingerprints;
  assert.equal(proof.originalIntentId, f.events[0].id);
  assert.deepEqual(proof.mapping, outcome.mapping);
  assert.equal(proof.claimId, batch.claim_id);
  assert.equal(proof.evidenceFingerprint, caseRow.evidenceFingerprint);
  assert.equal(f.calls.some((call) => call.type === 'rpc' && call.name.includes('link')), false);
  assert.deepEqual(f.calls.filter((row) => row.type === 'provider').map((row) => row.options.method), ['GET', 'POST', 'GET']);
});

test('draft gate and required write scope fail before POST', async () => {
  const f = draftFixture();
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, env: {} }), /disabled/);
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, connection: { tenantId, scope: 'accounting.invoices.read' } }), /write scope/);
  assert.equal(f.posts, 0);
});

test('draft never upgrades an approved posting mode to AUTHORISED', async () => {
  const f = draftFixture();
  f.tables.xero_financial_sync_runs[0] = { ...run, control_totals: { ...run.control_totals, postingMode: 'authorised' } };
  await assert.rejects(executeCampaignBatch(f.dependencies), /DRAFT posting mode/);
  assert.equal(f.posts, 0);
});

test('draft source drift and late existing target prohibit POST', async () => {
  const changed = draftFixture({ sourceDrift: { financialFingerprint: 'new-financial' } });
  await assert.rejects(executeCampaignBatch(changed.dependencies), /evidence changed/);
  assert.equal(changed.posts, 0);
  const duplicate = draftFixture({ existingTarget: true });
  await assert.rejects(executeCampaignBatch(duplicate.dependencies), /now exists/);
  assert.equal(duplicate.posts, 0);
});

test('draft intent storage failure leaves no provider write', async () => {
  const f = draftFixture({ auditFailure: 'campaign_document_intent' });
  await assert.rejects(executeCampaignBatch(f.dependencies), /durably saved/);
  assert.equal(f.posts, 0);
});

test('draft settlement, status or line drift cannot produce an original verified receipt', async () => {
  for (const readbackDrift of [{ Status: 'AUTHORISED' }, { LineItems: [] }, { AmountPaid: 20, AmountDue: 80 }, { DueDate: '2026-10-01' }]) {
    const f = draftFixture({ readbackDrift });
    await assert.rejects(executeCampaignBatch(f.dependencies), /not confirm|not confirmed/);
    assert.equal(f.events.some((row) => row.event_type === 'campaign_document_verified'), false);
    assert.equal(f.calls.some((row) => row.type === 'release'), false);
  }
});

test('lost draft POST response is resolved by readback and recovery never posts it again', async () => {
  const f = draftFixture({ unknownPost: true });
  const [first] = await executeCampaignBatch(f.dependencies);
  assert.equal(first.targetId, f.target.InvoiceID);
  assert.equal(f.posts, 1);
  const [recovered] = await executeCampaignBatch({ ...f.dependencies, recovering: true });
  assert.equal(recovered.targetId, first.targetId);
  assert.equal(f.posts, 1);
  assert.equal(f.events.filter((row) => row.event_type === 'campaign_document_intent').length, 1);
});

test('recovering draft without an original journal never creates a new document', async () => {
  const f = draftFixture();
  const [outcome] = await executeCampaignBatch({ ...f.dependencies, recovering: true });
  assert.equal(outcome.status, 'needs_decision');
  assert.equal(outcome.definitiveNoWrite, true);
  assert.equal(f.posts, 0);
});

function referencePaymentFixture(options = {}) {
  const paymentId = 'a0S000000000001';
  const paymentTarget = '44444444-4444-4444-8444-444444444444';
  const documentId = '33333333-3333-4333-8333-333333333333';
  const mappingId = '55555555-5555-4555-8555-555555555555';
  const bankId = '66666666-6666-4666-8666-666666666666';
  const saved = { salesforcePaymentId: paymentId, salesforcePaymentName: 'Allocation 1',
    action: 'payment_reference_link', status: 'eligible', blockers: [], proposedPayment: null,
    sourceFingerprint: '1'.repeat(64), reviewFingerprint: '2'.repeat(64), referenceReviewFingerprint: '2'.repeat(64),
    documentMappingId: mappingId, xeroDocumentId: documentId, xeroPaymentId: paymentTarget,
    bankAccountId: bankId, amount: 20, currency: 'USD', paymentDate: '2026-09-01',
    retainedReferenceEvidence: { version: 1, tenantId, payment: { id: paymentTarget, reference: 'Original reference' } } };
  const document = { id: mappingId, xero_document_id: documentId, xero_contact_id: 'contact-one' };
  const invoice = { ...raw, InvoiceID: documentId, AmountDue: 80, AmountPaid: 20,
    Payments: [{ PaymentID: paymentTarget, Amount: 20 }] };
  const payment = { PaymentID: paymentTarget, Amount: 20, Date: saved.paymentDate, Status: 'AUTHORISED',
    Invoice: { InvoiceID: documentId, CurrencyCode: 'USD' }, Account: { AccountID: bankId }, Reference: 'Original reference' };
  const savedRun = { ...run, control_totals: { ...run.control_totals,
    workflowSnapshot: { ...run.control_totals.workflowSnapshot, payments: { rows: [saved] } } } };
  const f = fixture({ run: savedRun, documentMappings: [document] });
  f.dependencies = { ...f.dependencies, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, cases: [{ ...caseRow, id: `${tenantId}:Payment__c:${paymentId}`,
    sourceObject: 'Payment__c', sourceId: paymentId, targetId: paymentTarget }],
    batch: { ...batch, forecast: { ...batch.forecast, verificationCalls: 2 } },
    loadPayments: async () => [{ Id: paymentId }],
    classifyPayments: async () => ({ tenantId, rows: [{ ...saved, ...(options.fresh || {}) }] }),
    refreshInventory: async () => ({ ...inventory, rawTargets: { invoices: [{ ...invoice, ...(options.invoiceDrift || {}) }], creditNotes: [] },
      paymentReadSnapshot: { invoices: [invoice], payments: [{ ...payment, ...(options.paymentDrift || {}) }] } }),
    accountingFetch: async (_connection, path, request) => { f.calls.push({ type: 'provider', path, options: request });
      return path.startsWith('/Payments/') ? { Payments: [{ ...payment, ...(options.secondPaymentDrift || {}) }] } : { Invoices: [invoice] }; },
  };
  return { ...f, saved, document, invoice, payment };
}

test('payment reference returns its original reviewed row and idempotency key without a direct link RPC', async () => {
  const f = referencePaymentFixture();
  const [outcome] = await executeCampaignBatch(f.dependencies);
  assert.equal(outcome.status, 'reconciled');
  assert.equal(outcome.paymentMapping, undefined);
  assert.deepEqual(outcome.paymentReferenceRow.retainedReferenceEvidence, f.saved.retainedReferenceEvidence);
  assert.match(outcome.paymentReferenceRow.idempotencyKey, /^payment-post:[a-f0-9]{64}$/);
  assert.equal(outcome.paymentEvidence.reviewFingerprint, f.saved.reviewFingerprint);
  assert.deepEqual(f.calls.filter((row) => row.type === 'provider').map((row) => row.options.method), ['GET', 'GET']);
});

test('payment reference drift, absent invoice allocation and changed payment bank prevent reconciliation', async () => {
  for (const options of [
    { fresh: { retainedReferenceEvidence: { changed: true } } },
    { invoiceDrift: { Payments: [] } },
    { paymentDrift: { Account: { AccountID: 'other-bank' } } },
    { paymentDrift: { Date: '2026-09-02' } },
    { secondPaymentDrift: { Reference: 'Changed reference' } },
  ]) {
    const f = referencePaymentFixture(options);
    const [outcome] = await executeCampaignBatch(f.dependencies);
    assert.equal(outcome.status, 'needs_decision');
    assert.equal(outcome.paymentReferenceRow, undefined);
  }
});

test('draft source reread drift prohibits writing after a matching initial classification', async () => {
  const f = draftFixture();
  let classifications = 0;
  const original = f.dependencies.classify;
  f.dependencies.classify = (...args) => {
    classifications += 1;
    const classified = original(...args);
    return classifications === 1 ? classified : { rows: classified.rows.map((row) => ({ ...row, sourceFingerprint: 'changed' })) };
  };
  await assert.rejects(executeCampaignBatch(f.dependencies), /immediately before/);
  assert.equal(f.posts, 0);
});

test('draft recovery requires the same source and claim as the original intent', async () => {
  const f = draftFixture();
  await executeCampaignBatch(f.dependencies);
  f.events[0].fingerprints.sourceFingerprint = 'forged-source';
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, recovering: true }), /original draft intent changed/);
  assert.equal(f.posts, 1);
});

test('ambiguous lost draft outcome remains unresolved and recovery never resends POST', async () => {
  const f = draftFixture({ unknownPost: true });
  const original = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (...args) => {
    const response = await original(...args);
    return args[1].includes('?where=') ? { Invoices: [] } : response;
  };
  await assert.rejects(executeCampaignBatch(f.dependencies), /outcome is unconfirmed/);
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, recovering: true }), /outcome is unconfirmed/);
  assert.equal(f.posts, 1);
  assert.equal(f.calls.some((row) => row.type === 'release'), false);
});

function groupPaymentFixture() {
  const f = referencePaymentFixture();
  const common = { IsDeleted: false, CreatedDate: '2026-01-02T00:00:00Z', LastModifiedDate: '2026-01-02T00:00:01Z',
    Date__c: f.saved.paymentDate, Supplier_Invoice__c: null, Reference__c: null, Is_Deposit__c: false,
    Is_Volume_Discount__c: false, Commission_Invoice__c: null, CurrencyIsoCode: 'USD',
    _currency: { currency: 'USD', blockers: [] } };
  const groupId = '001000000000001'; const accountId = '001000000000002'; const stemId = 'a0H000000000001';
  const parent = { ...common, Id: 'a0S000000000002', Name: 'Group receipt', RecordType: { DeveloperName: 'Receivable_Remittance' },
    Account__c: groupId, Amount__c: 20, Bank__c: 'UBS', Remittance__c: null, STEM__c: null };
  const selected = { ...common, Id: f.saved.salesforcePaymentId, Name: f.saved.salesforcePaymentName,
    RecordType: { DeveloperName: 'Receivable' }, Account__c: accountId, Amount__c: 20,
    Bank__c: null, Remittance__c: parent.Id, STEM__c: stemId };
  const account = (Id, Name, type, ParentId, company) => ({ Id, IsDeleted: false, Name,
    RecordType: { DeveloperName: type }, ParentId, Company_Code__c: company, Inactive_Suspended__c: false,
    LastModifiedDate: '2026-01-01T00:00:00Z' });
  const accounts = [account(groupId, 'GROUP - FRATELLI COSULICH', 'Group', null, 'GROUP - FC'),
    account(accountId, 'FRATELLI COSULICH UNIPESSOAL SA', 'Buyer_Supplier', groupId, 'HK DISTINCT')];
  const invoice = { Id: 'a0K000000000001', IsDeleted: false, Name: 'INV-1', STEM__c: stemId,
    STEM__r: { Account__c: accountId }, Amount__c: 20, Proforma__c: false, Deprecated__c: false, Is_Credit_Note__c: false,
    CreatedDate: '2025-12-30T00:00:00Z', LastModifiedDate: '2026-01-01T00:00:00Z', Invoice_Date__c: '2025-12-30',
    Invoice_Due_Date__c: '2026-01-13', CurrencyIsoCode: 'USD', _currency: { currency: 'USD', blockers: [] } };
  const evaluated = resolveGroupRemittanceBankEvidence(selected, { parent, siblings: [selected], visiblePayments: [parent, selected],
    accounts, buyerDocumentInventories: [{ stemId, complete: true, creditFields: ['Is_Credit_Note__c'], records: [invoice] }], complete: true });
  assert.equal(evaluated.eligible, true, evaluated.blocker);
  const contact = '77777777-7777-4777-8777-777777777777';
  Object.assign(f.document, { salesforce_object: 'Invoice__c', salesforce_id: invoice.Id,
    xero_document_type: 'ACCREC', xero_contact_id: contact, source_fingerprint: '3'.repeat(64),
    retained_differences: { accountId, stemId }, protected_legacy: true });
  f.invoice.Contact = { ContactID: contact };
  delete f.saved.retainedReferenceEvidence;
  delete f.saved.referenceReviewFingerprint;
  Object.assign(f.saved, { action: 'payment_link', status: 'eligible', bankSourceEvidence: evaluated.evidence,
    documentMappingSnapshot: structuredClone(f.document), bankMappingSnapshot: {
      id: '88888888-8888-4888-8888-888888888888', salesforce_bank_name: 'UBS',
      xero_bank_account_id: f.saved.bankAccountId, revision: 2, enabled: true } });
  return f;
}

test('Group existing payment returns the original validated bank source proof and posting key', async () => {
  const f = groupPaymentFixture();
  const [outcome] = await executeCampaignBatch(f.dependencies);
  assert.equal(outcome.status, 'reconciled');
  assert.equal(outcome.paymentMapping, undefined);
  assert.deepEqual(outcome.groupPaymentRow.bankSourceEvidence, f.saved.bankSourceEvidence);
  assert.deepEqual(outcome.groupPaymentRow.documentMappingSnapshot, f.saved.documentMappingSnapshot);
  assert.match(outcome.groupPaymentRow.idempotencyKey, /^payment-post:[a-f0-9]{64}$/);
});

test('Group proof corruption cannot manufacture an original payment receipt', async () => {
  const f = groupPaymentFixture();
  f.saved.bankSourceEvidence = { ...structuredClone(f.saved.bankSourceEvidence), fingerprint: '0'.repeat(64) };
  const [outcome] = await executeCampaignBatch(f.dependencies);
  assert.equal(outcome.status, 'needs_decision');
  assert.equal(outcome.groupPaymentRow, undefined);
  assert.equal(f.calls.filter((row) => row.type === 'provider').length, 0);
});

test('payment reference keeps the original financial enablement gate', async () => {
  const f = referencePaymentFixture();
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, env: {} }), /disabled/);
  assert.equal(f.calls.filter((row) => row.type === 'provider').length, 0);
});

test('draft cannot accept a zero provider document identity', async () => {
  const f = draftFixture({ postDrift: { InvoiceID: '00000000-0000-0000-0000-000000000000' } });
  await assert.rejects(executeCampaignBatch(f.dependencies), /not confirmed/);
  assert.equal(f.events.some((row) => row.event_type === 'campaign_document_verified'), false);
});

function unknownRecoveryFixture({ capacity = 'sufficient' } = {}) {
  const f = draftFixture({ unknownPost: true });
  let recovery = false;
  let scopedBudget = null;
  let resolved = false;
  const ownerKey = `campaign:${campaign.id}:${f.dependencies.batch.id}:${f.dependencies.batch.claim_id}`;
  f.dependencies.connection = bindXeroSharedControl(f.dependencies.connection, { resolveUnknown: async (request) => {
    const original = f.tables.xero_shared_budgets[0];
    assert.equal(request.requestId, f.events[0].fingerprints.postRequestId);
    assert.equal(request.verificationRequestId, 'verified-request');
    assert.match(request.evidenceReference, /^xero_financial_audit_events:[1-9][0-9]*$/);
    assert.ok(scopedBudget === original.id || original.state === 'released');
    resolved = true;
  } });
  f.dependencies.reserveBudget = async (_connection, request) => {
    const saved = { id: `budget-${f.tables.xero_shared_budgets.length + 1}`, tenant_id: tenantId, owner_key: request.ownerKey,
      operation_remaining: request.operationCalls, verification_remaining: request.verificationCalls,
      state: 'active', expires_at: new Date(Date.now() + 600000).toISOString() };
    f.tables.xero_shared_budgets.push(saved);
    f.calls.push({ type: 'reserve', request }); return saved;
  };
  f.dependencies.releaseBudget = async (_connection, request) => {
    f.calls.push({ type: 'release', request });
    const row = f.tables.xero_shared_budgets.find((budget) => budget.id === request.budgetId);
    if (row) row.state = 'released';
  };
  f.dependencies.withBudget = async (_connection, scope, work) => {
    scopedBudget = scope.budgetId;
    f.calls.push({ type: 'scope', scope }); return work();
  };
  const original = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (...args) => {
    if (args[2].method === 'GET' && args[1].includes('?where=') && f.posts && !recovery) {
      throw new Error('Verification admission unavailable');
    }
    try {
      const response = await original(...args);
      if (args[2].method === 'GET') args[2].onResponse?.({ status: 200, requestId: 'verified-request', budgetId: scopedBudget });
      return response;
    } catch (error) {
      if (args[2].method !== 'POST') throw error;
      throw Object.assign(new Error('Known unknown provider write'), { code: 'XERO_WRITE_OUTCOME_UNKNOWN',
        details: { outcomeUnknown: true, requestId: args[2].requestId, budgetId: scopedBudget } });
    }
  };
  return { ...f, ownerKey, get resolved() { return resolved; }, startRecovery() {
    recovery = true;
    if (capacity === 'insufficient') f.tables.xero_shared_budgets[0].verification_remaining = 0;
  } };
}

test('immediate known-unknown recovery reuses the original active claim reservation', async () => {
  const f = unknownRecoveryFixture();
  await assert.rejects(executeCampaignBatch(f.dependencies), /admission unavailable/);
  f.startRecovery();
  const [outcome] = await executeCampaignBatch({ ...f.dependencies, recovering: true });
  assert.equal(outcome.status, 'reconciled');
  assert.equal(f.resolved, true);
  assert.equal(f.calls.filter((call) => call.type === 'reserve').length, 1);
  assert.equal(f.dependencies.batch.claim_id, batch.claim_id);
});

test('insufficient original recovery capacity releases that budget before reserving fresh same-claim capacity', async () => {
  const f = unknownRecoveryFixture({ capacity: 'insufficient' });
  await assert.rejects(executeCampaignBatch(f.dependencies), /admission unavailable/);
  f.startRecovery();
  const [outcome] = await executeCampaignBatch({ ...f.dependencies, recovering: true });
  assert.equal(outcome.status, 'reconciled');
  assert.equal(f.resolved, true);
  const operations = f.calls.filter((call) => ['reserve', 'release'].includes(call.type));
  assert.deepEqual(operations.map((call) => call.type), ['reserve', 'release', 'reserve', 'release']);
  assert.equal(operations[2].request.ownerKey, f.ownerKey);
});

test('recovery never rotates or reads while the original provider request is still in flight', async () => {
  const f = unknownRecoveryFixture({ capacity: 'insufficient' });
  await assert.rejects(executeCampaignBatch(f.dependencies), /admission unavailable/);
  f.startRecovery();
  f.tables.xero_shared_requests.push({ id: 'pending-request', budget_id: 'budget-1', tenant_id: tenantId,
    state: 'inflight', deadline_at: new Date(Date.now() + 60000).toISOString() });
  const reads = f.calls.filter((call) => call.type === 'provider').length;
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, recovering: true }), /still in flight/);
  assert.equal(f.calls.filter((call) => call.type === 'release').length, 0);
  assert.equal(f.calls.filter((call) => call.type === 'provider').length, reads);
});

test('conclusive HTTP400 validation failure holds one case while independently approved drafts continue', async () => {
  const f = draftFixture();
  const secondSource = { ...f.tables.xero_financial_sync_items[0].source_payload, salesforceId: 'invoice-two', documentNumber: 'INV-2' };
  const secondPayload = buildXeroAccountingPayload(secondSource);
  const secondCurrent = { ...secondSource, action: 'create_draft', status: 'eligible', blockers: [], differences: [], proposedPayload: secondPayload };
  const secondItem = toSyncItemRow(secondCurrent, run.id, 1, '2026-09-30T00:00:00Z');
  const secondCase = { ...f.draftCase, id: `${tenantId}:Invoice__c:invoice-two`, sourceId: 'invoice-two', evidenceFingerprint: 'b'.repeat(64) };
  f.tables.xero_financial_sync_items.push(secondItem);
  f.tables.xero_reconciliation_cases.push({ id: secondCase.id, campaign_id: campaign.id, evidence_fingerprint: secondCase.evidenceFingerprint });
  f.tables.xero_reconciliation_batches[0].claim_case_ids.push(secondCase.id);
  f.dependencies.cases.push(secondCase);
  f.dependencies.batch.forecast.verificationCalls = 4;
  const originalClassification = f.dependencies.classify;
  f.dependencies.classify = (...args) => ({ rows: [...originalClassification(...args).rows, secondCurrent] });
  const originalFetch = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (currentConnection, path, request) => {
    if (request.method === 'POST' && request.body.Invoices[0].InvoiceNumber === 'INV-1') {
      request.onResponse({ status: 400, requestId: request.requestId, budgetId: 'budget-one' });
      throw Object.assign(new Error('Validation rejected'), { status: 400, code: 'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED' });
    }
    if (request.method === 'GET' && path.includes('?where=')) return { Invoices: [] };
    const response = await originalFetch(currentConnection, path, request);
    return { Invoices: response.Invoices.map((row) => ({ ...row, ...secondPayload })) };
  };
  const outcomes = await executeCampaignBatch(f.dependencies);
  assert.deepEqual(outcomes.map((row) => row.status), ['needs_decision', 'reconciled']);
  assert.equal(outcomes[0].definitiveNoWrite, true);
  const receipt = f.events.find((row) => row.id === outcomes[0].receiptId);
  assert.equal(receipt.fingerprints.providerStatus, 400);
  assert.equal(receipt.fingerprints.outcomeUnknown, false);
  assert.equal(f.calls.filter((row) => row.type === 'release').length, 1);
});

test('ambiguous HTTP400 without an original provider receipt remains unresolved', async () => {
  const f = draftFixture();
  f.dependencies.accountingFetch = async (_connection, _path, request) => {
    if (request.method === 'POST') {
      f.tables.xero_shared_requests.push({id:request.requestId,tenant_id:tenantId,budget_id:f.events[0].fingerprints.postBudgetId,token_version:1,
        resource_key:'Invoices',method:'POST',phase:'operation',state:'unknown',outcome_unknown:true});
      throw Object.assign(new Error('Uncorrelated validation-looking error'), { status: 400, code: 'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED' });
    }
    return { Invoices: [] };
  };
  await assert.rejects(executeCampaignBatch(f.dependencies), /outcome is unconfirmed/);
  assert.equal(f.events[1].fingerprints.definitiveNoWrite, false);
});

test('draft audit receipts use the actual bigint generated-always schema', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const migration = await readFile(new URL('../supabase/migrations/20260829080726_xero_financial_sync.sql', import.meta.url), 'utf8');
  const schema = migration.match(/create table if not exists public\.xero_financial_audit_events \([\s\S]*?\n\);/)[0];
  await db.exec('create table public.xero_financial_sync_runs(id uuid primary key);');
  await db.exec(schema);
  const f = draftFixture();
  const mockFrom = f.dependencies.client.from;
  f.dependencies.actor = { id: '99999999-9999-4999-8999-999999999999', email: 'finance@example.test' };
  f.dependencies.client.from = (table) => {
    if (table !== 'xero_financial_audit_events') return mockFrom(table);
    const query = mockFrom(table);
    query.insert = (row) => ({ select() { return this; }, async maybeSingle() {
      assert.equal(Object.hasOwn(row, 'id'), false);
      const inserted = await db.query(`insert into public.xero_financial_audit_events(run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints)
        values($1,$2,$3,$4,$5,$6,$7) returning id`, [row.run_id,row.event_type,row.outcome,row.actor_id,row.actor_email,
        JSON.stringify(row.record_counts),JSON.stringify(row.fingerprints)]);
      f.events.push({ ...row, id: String(inserted.rows[0].id) });
      return { data: inserted.rows[0], error: null };
    } });
    return query;
  };
  const [outcome] = await executeCampaignBatch(f.dependencies);
  assert.match(outcome.receiptId, /^[1-9][0-9]*$/);
  assert.match(outcome.originalIntentId, /^[1-9][0-9]*$/);
  const audits = await db.query('select id,event_type,fingerprints from public.xero_financial_audit_events order by id');
  assert.equal(audits.rows.length, 3);
  assert.equal(audits.rows[2].fingerprints.originalIntentId, String(audits.rows[0].id));
  assert.equal(audits.rows[2].fingerprints.mapping.xero_document_id, outcome.mapping.xero_document_id);
});

test('expired budget cannot hide an original provider request with a future deadline', async () => {
  const f = unknownRecoveryFixture();
  await assert.rejects(executeCampaignBatch(f.dependencies), /admission unavailable/);
  f.startRecovery();
  f.tables.xero_shared_budgets[0].expires_at = new Date(Date.now() - 1000).toISOString();
  f.tables.xero_shared_requests.push({ id: 'pending-request', budget_id: 'budget-1', tenant_id: tenantId,
    state: 'inflight', deadline_at: new Date(Date.now() + 60000).toISOString() });
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, recovering: true }), /still in flight/);
  assert.equal(f.calls.filter((call) => call.type === 'reserve').length, 1);
});

test('recovery refuses fresh capacity unless original reservation release is durably confirmed', async () => {
  const f = unknownRecoveryFixture({ capacity: 'insufficient' });
  await assert.rejects(executeCampaignBatch(f.dependencies), /admission unavailable/);
  f.startRecovery();
  f.dependencies.releaseBudget = async () => ({});
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, recovering: true }), /release is unconfirmed/);
  assert.equal(f.calls.filter((call) => call.type === 'reserve').length, 1);
});

test('one rejected summarizeErrors=false response proves no draft write only with exact submitted identity', async () => {
  for (const ambiguous of [false, true]) {
    const f = draftFixture();
    const originalFetch = f.dependencies.accountingFetch;
    f.dependencies.accountingFetch = async (currentConnection, path, request) => {
      if (request.method !== 'POST') return originalFetch(currentConnection, path, request);
      f.tables.xero_shared_requests.push({id:request.requestId,tenant_id:tenantId,budget_id:f.events[0].fingerprints.postBudgetId,token_version:1,
        resource_key:'Invoices',method:'POST',phase:'operation',state:'complete',outcome_unknown:false});
      return { Invoices: [{ ...request.body.Invoices[0], InvoiceID: undefined, HasValidationErrors: true,
        Contact: ambiguous ? { ContactID: 'different-contact' } : request.body.Invoices[0].Contact,
        ValidationErrors: [{ Message: 'The account code is invalid.' }] }] };
    };
    if (ambiguous) await assert.rejects(executeCampaignBatch(f.dependencies), /not uniquely confirmed/);
    else {
      const [outcome] = await executeCampaignBatch(f.dependencies);
      assert.equal(outcome.status, 'needs_decision');
      assert.equal(outcome.definitiveNoWrite, true);
      const [recovered] = await executeCampaignBatch({ ...f.dependencies, recovering: true });
      assert.equal(recovered.definitiveNoWrite, true);
    }
  }
});

test('recovery normalizes PostgREST numeric bigint audit IDs to original decimal receipt strings', async () => {
  const f = draftFixture();
  const originalFetch = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (currentConnection, path, request) => request.method === 'POST'
    ? { Invoices: [{ ...request.body.Invoices[0], InvoiceID: undefined, HasValidationErrors: true,
      ValidationErrors: [{ Message: 'The account code is invalid.' }] }] }
    : originalFetch(currentConnection, path, request);
  await executeCampaignBatch(f.dependencies);
  for (const event of f.events) event.id = Number(event.id);
  const [outcome] = await executeCampaignBatch({ ...f.dependencies, recovering: true });
  assert.equal(outcome.status, 'needs_decision');
  assert.equal(outcome.originalIntentId, '1');
  assert.equal(outcome.receiptId, '2');
  assert.equal(outcome.definitiveNoWrite, true);
});

test('executor loads document and payment evidence from the current refreshed review run', async () => {
  const refreshedRun = { ...run, id: 'review-two' };
  const f = fixture({ run: refreshedRun, item: { ...item, run_id: refreshedRun.id } });
  const [outcome] = await executeCampaignBatch({ ...f.dependencies,
    campaign: { ...campaign, review_run_id: refreshedRun.id } });
  assert.equal(outcome.status, 'reconciled');
  assert.equal(outcome.mapping.salesforce_id, item.source_id);
});

test('safe Contact no-write hold does not block another independent Contact verification', async () => {
  const f = fixture();
  const accounts = [
    { id: '001000000000001AAA', name: 'First Company', inactiveSuspended: false, recordType: 'Buyer' },
    { id: '001000000000002AAA', name: 'Second Company', inactiveSuspended: false, recordType: 'Buyer' },
  ];
  const contacts = accounts.map((account, index) => ({ ...caseRow, id: `${tenantId}:Account:${account.id}`,
    category: 'contact', sourceObject: 'Account', sourceId: account.id, sourceIds: [account.id], targetId: null,
    evidenceFingerprint: String(index + 1).repeat(64), ownerId: '22222222-2222-4222-8222-222222222222', baselineAt: '2026-09-30T00:00:00Z' }));
  let reads = 0;
  f.dependencies.loadSalesforce = async () => ({ groupedAccountSnapshot: { complete: true, accounts } });
  f.dependencies.refreshInventory = async (args) => { reads++; return { ...inventory,
    contacts: reads === 1 ? [] : args.inventory.contacts, rawTargets: { invoices: [], creditNotes: [] } }; };
  f.dependencies.executeContact = async (args) => args.case.sourceId === accounts[0].id
    ? { caseId: args.case.id, evidenceFingerprint: args.case.evidenceFingerprint, status: 'needs_decision', definitiveNoWrite: true, reason: 'Original request was rejected.' }
    : { caseId: args.case.id, evidenceFingerprint: args.case.evidenceFingerprint, status: 'reconciled', receiptId: '5', sourceIds: args.case.sourceIds,
      verifiedContact: { id: '33333333-3333-4333-8333-333333333333', name: accounts[1].name, status: 'ACTIVE' }, verificationFingerprint: 'c'.repeat(64) };
  const outcomes = await executeCampaignBatch({ ...f.dependencies, cases: contacts,
    batch: { ...batch, category: 'contact', forecast: { ...batch.forecast, writeCalls: 2, verificationCalls: 4 } } });
  assert.deepEqual(outcomes.map((row) => row.status), ['needs_decision', 'reconciled']);
  assert.equal(reads, 2);
  assert.equal(f.calls.filter((call) => call.type === 'release').length, 1);
});

test('exact known-unknown draft readback recovery resolves with disabled posting gate and invoice read scope', async () => {
  const f = unknownRecoveryFixture();
  await assert.rejects(executeCampaignBatch(f.dependencies), /admission unavailable/);
  f.startRecovery();
  f.dependencies.connection.scope = 'accounting.invoices.read';
  const before = f.calls.length;
  const [outcome] = await executeCampaignBatch({ ...f.dependencies, recovering: true, env: {} });
  assert.equal(outcome.status, 'reconciled');
  assert.equal(f.resolved, true);
  assert.ok(f.calls.slice(before).filter((call) => call.type === 'provider').every((call) => call.options.method === 'GET'));
});

test('disabled-gate draft recovery still rejects missing read scope and changed source evidence', async () => {
  const f = draftFixture();
  await executeCampaignBatch(f.dependencies);
  f.dependencies.connection.scope = 'accounting.settings.read';
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, recovering: true, env: {} }), /document read scope/);
  f.dependencies.connection.scope = 'accounting.invoices.read';
  const original = f.dependencies.classify;
  f.dependencies.classify = (...args) => ({ rows: original(...args).rows.map((row) => ({ ...row, sourceFingerprint: 'changed' })) });
  await assert.rejects(executeCampaignBatch({ ...f.dependencies, recovering: true, env: {} }), /financial evidence changed/);
});

test('draft write gate is checked again after intent immediately before submitting POST', async () => {
  const f = draftFixture();
  const original = f.dependencies.client.from;
  f.dependencies.client.from = (table) => {
    const query = original(table);
    if (table !== 'xero_financial_audit_events') return query;
    const insert = query.insert;
    query.insert = (row) => { const result = insert(row);
      if (row.event_type === 'campaign_document_intent') f.dependencies.env.FCOS_ENABLE_XERO_FINANCIAL_SYNC = 'false';
      return result;
    };
    return query;
  };
  const [held] = await executeCampaignBatch(f.dependencies);
  assert.equal(held.status, 'needs_decision');
  assert.equal(held.definitiveNoWrite, true);
  assert.equal(f.events[1].fingerprints.submitted, false);
  assert.equal(f.posts, 0);
});

test('native draft admission survives crash before observation and response journal, then resolves original request by GET only',async()=>{
  const f=draftFixture();let created=false;let recovering=false;const fetches=[];const resolutions=[];
  const requests=f.tables.xero_shared_requests;
  const control=fixtureSharedControl({
    admit:async args=>{
      for(const request of requests)if(request.state==='inflight'&&Date.parse(request.deadline_at)<=Date.now()){
        request.state='unknown';request.outcome_unknown=request.method!=='GET';
      }
      const requestId=args.requestId||randomUUID();
      if(args.method==='POST')assert.equal(requestId,f.events.at(-1).fingerprints.postRequestId);
      requests.push({id:requestId,tenant_id:tenantId,budget_id:args.budgetId,token_version:args.tokenVersion,method:args.method,
        resource_key:args.resourceKey,phase:args.budgetPhase,state:'inflight',outcome_unknown:false,deadline_at:new Date(Date.now()+60000).toISOString()});
      return{requestId};
    },observe:async args=>{
      const request=requests.find(row=>row.id===args.requestId);
      if(request.method==='POST'&&!recovering)throw Error('crash before observation committed');
      Object.assign(request,{state:'complete',response_status:args.status,outcome_unknown:args.outcomeUnknown});return{recorded:true};
    },resolveUnknown:async facts=>{
      const post=requests.find(row=>row.id===facts.requestId),verification=requests.find(row=>row.id===facts.verificationRequestId);
      assert.equal(post.outcome_unknown,true);assert.equal(verification.method,'GET');assert.equal(verification.phase,'verification');
      assert.equal(verification.response_status,200);assert.equal(verification.budget_id,post.budget_id);
      post.outcome_unknown=false;post.state='complete';resolutions.push(facts);return true;
    },
  });
  f.dependencies.connection=bindXeroSharedControl({...f.dependencies.connection,accessToken:'synthetic'},control);
  f.dependencies.accountingFetch=xeroAccountingFetch;f.dependencies.withBudget=runWithXeroBudget;
  f.dependencies.fetchImpl=async(input,options)=>{
    fetches.push(options.method);if(options.method==='POST')created=true;
    const url=new URL(input);return new Response(JSON.stringify({Invoices:url.searchParams.has('where')&&!created?[]:[f.target]}),{status:200});
  };
  await assert.rejects(executeCampaignBatch(f.dependencies),/still in flight/);
  assert.deepEqual(f.events.map(row=>row.event_type),['campaign_document_intent']);
  const post=requests.find(row=>row.method==='POST');assert.equal(post.id,f.events[0].fingerprints.postRequestId);
  post.deadline_at=new Date(Date.now()-1000).toISOString();recovering=true;f.dependencies.connection.scope='accounting.invoices.read';
  const [result]=await executeCampaignBatch({...f.dependencies,recovering:true,env:{}});
  assert.equal(result.status,'reconciled');assert.equal(resolutions.length,1);assert.equal(resolutions[0].requestId,post.id);
  assert.equal(post.outcome_unknown,false);assert.deepEqual(fetches,['GET','POST','GET','GET']);
});

test('new approved draft claim can follow prior conclusive rejection and cannot borrow unresolved prior intent',async()=>{
  const f=draftFixture();const original=f.dependencies.accountingFetch;let reject=true;
  f.dependencies.accountingFetch=async(connection,path,options)=>{
    if(options.method==='POST'&&reject){reject=false;options.onResponse({status:400,requestId:options.requestId});
      throw Object.assign(Error('rejected'),{status:400,code:'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED'});}
    return original(connection,path,options);
  };
  assert.equal((await executeCampaignBatch(f.dependencies))[0].definitiveNoWrite,true);
  f.dependencies.batch.claim_id=randomUUID();const [created]=await executeCampaignBatch(f.dependencies);
  assert.equal(created.status,'reconciled');assert.equal(f.posts,1);assert.equal(f.events.filter(row=>row.event_type==='campaign_document_intent').length,2);
  const pending=draftFixture({unknownPost:true});await executeCampaignBatch(pending.dependencies);pending.dependencies.batch.claim_id=randomUUID();
  await assert.rejects(executeCampaignBatch(pending.dependencies),/earlier claim remains unresolved/);
});

test('prior verified draft claim retires only after exact immutable case outcome committed it',async()=>{
  for(const finish of ['missing','exact','wrong-fingerprint']){
    const f=draftFixture();const [result]=await executeCampaignBatch(f.dependencies);
    if(finish!=='missing')f.tables.xero_reconciliation_events.push({campaign_id:campaign.id,batch_id:f.dependencies.batch.id,event_type:'case_outcome',
      evidence:{...result,...(finish==='wrong-fingerprint'?{verificationFingerprint:'0'.repeat(64)}:{})}});
    f.dependencies.batch.claim_id=randomUUID();
    if(finish==='exact'){
      const [held]=await executeCampaignBatch({...f.dependencies,recovering:true});assert.equal(held.definitiveNoWrite,true);assert.equal(held.originalIntentId,undefined);
    }else await assert.rejects(executeCampaignBatch({...f.dependencies,recovering:true}),/earlier claim remains unresolved/);
    assert.equal(f.posts,1);
  }
});

test('actual complete draft receipt avoids resolving a journal-only observation uncertainty',async()=>{
  const f=draftFixture({unknownPost:true});const original=f.dependencies.accountingFetch;const resolved=[];
  f.dependencies.connection=bindXeroSharedControl(f.dependencies.connection,{resolveUnknown:async args=>resolved.push(args)});
  f.dependencies.accountingFetch=async(...args)=>{
    try{return await original(...args);}catch(error){
      if(args[2].method==='POST'){
        f.tables.xero_shared_requests.at(-1).state='complete';f.tables.xero_shared_requests.at(-1).outcome_unknown=false;
        throw Object.assign(error,{details:{outcomeUnknown:true,requestId:args[2].requestId}});
      }throw error;
    }
  };
  const [outcome]=await executeCampaignBatch(f.dependencies);assert.equal(outcome.status,'reconciled');
  assert.equal(f.events[1].fingerprints.outcomeUnknown,true);assert.equal(resolved.length,0);
});

test('draft recovery of durable intent never admitted records no-write proof and never POSTs',async()=>{
  const f=draftFixture();const original=f.dependencies.client.from;let failResponse=true;
  f.dependencies.client.from=table=>{
    const query=original(table);if(table!=='xero_financial_audit_events')return query;
    const insert=query.insert;query.insert=row=>{
      if(row.event_type==='campaign_document_response'&&failResponse)return{select:()=>({maybeSingle:async()=>({error:{message:'worker crashed before response journal'}})})};
      const result=insert(row);if(row.event_type==='campaign_document_intent')f.dependencies.env.FCOS_ENABLE_XERO_FINANCIAL_SYNC='false';return result;
    };return query;
  };
  await assert.rejects(executeCampaignBatch(f.dependencies),/durably saved/);
  assert.deepEqual(f.events.map(row=>row.event_type),['campaign_document_intent']);assert.equal(f.tables.xero_shared_requests.length,0);
  failResponse=false;f.dependencies.connection.scope='accounting.invoices.read';
  const [held]=await executeCampaignBatch({...f.dependencies,recovering:true});
  assert.equal(held.definitiveNoWrite,true);assert.equal(held.originalIntentId,'1');assert.equal(f.events.at(-1).fingerprints.submitted,false);assert.equal(f.posts,0);
});

function supplierNumberFixture(options={}) {
  const f=draftFixture({...options,supplier:true});
  const foreign={...structuredClone(f.target),InvoiceID:'88888888-8888-4888-8888-888888888888',
    Contact:{ContactID:'99999999-9999-4999-8999-999999999999'},Status:'AUTHORISED'};
  const original=f.dependencies.accountingFetch;
  f.dependencies.accountingFetch=async(connection,path,request)=>{
    const result=await original(connection,path,request);
    if(request.method==='GET'&&path.includes('?where=')){
      const where=new URL(`https://fixture.invalid${path}`).searchParams.get('where');
      assert.equal(where,`InvoiceNumber=="HK2626001T-VESSEL"&&Type=="ACCPAY"&&Contact.ContactID==Guid("${f.target.Contact.ContactID}")`);
      return {Invoices:[...result.Invoices,...(options.extraRows||[foreign])]};
    }
    return result;
  };
  return {...f,foreign,get posts(){return f.posts;}};
}

test('supplier draft preflight excludes a validated other Contact bill with the same stem/vessel number',async()=>{
  const f=supplierNumberFixture();const [outcome]=await executeCampaignBatch(f.dependencies);
  assert.equal(outcome.status,'reconciled');assert.equal(f.posts,1);
  assert.equal(outcome.mapping.xero_contact_id,f.target.Contact.ContactID);assert.equal(outcome.targetId,f.target.InvoiceID);
});

test('supplier draft lost-response recovery finds its exact Contact bill among foreign same-number rows without another POST',async()=>{
  const f=supplierNumberFixture({unknownPost:true});
  f.dependencies.connection=bindXeroSharedControl(f.dependencies.connection,{resolveUnknown:async({requestId})=>{
    Object.assign(f.tables.xero_shared_requests.find(row=>row.id===requestId),{state:'complete',outcome_unknown:false});return true;
  }});
  const [first]=await executeCampaignBatch(f.dependencies);const before=f.calls.length;
  f.dependencies.connection.scope='accounting.invoices.read';
  const [recovered]=await executeCampaignBatch({...f.dependencies,recovering:true,env:{}});
  assert.equal(recovered.targetId,first.targetId);assert.equal(f.posts,1);
  const reads=f.calls.slice(before).filter(row=>row.type==='provider');
  assert.equal(reads.length,2);assert.ok(reads.every(row=>row.options.method==='GET'));
});

test('same supplier Contact number collisions still block preflight and ambiguous readback recovery',async()=>{
  const before=draftFixture({supplier:true});
  const duplicate={...structuredClone(before.target),InvoiceID:'88888888-8888-4888-8888-888888888888'};
  const f=supplierNumberFixture({extraRows:[duplicate]});
  await assert.rejects(executeCampaignBatch(f.dependencies),/now exists/);assert.equal(f.posts,0);
  const recovering=supplierNumberFixture({unknownPost:true});await executeCampaignBatch(recovering.dependencies);
  const original=recovering.dependencies.accountingFetch;
  recovering.dependencies.accountingFetch=async(...args)=>{
    const result=await original(...args);
    return args[1].includes('?where=')?{Invoices:[...result.Invoices,{...structuredClone(recovering.target),InvoiceID:duplicate.InvoiceID}]}:result;
  };
  await assert.rejects(executeCampaignBatch({...recovering.dependencies,recovering:true}),/outcome is unconfirmed/);
  assert.equal(recovering.posts,1);
});

test('supplier search never excludes malformed returned Type or Contact identity as a harmless foreign bill',async()=>{
  for(const changed of [{Contact:null},{Contact:{ContactID:'malformed'}},{Contact:{ContactID:'00000000-0000-0000-0000-000000000000'}},{Type:'UNKNOWN'}]){
    const f=supplierNumberFixture();const original=f.dependencies.accountingFetch;
    f.dependencies.accountingFetch=async(...args)=>{
      const result=await original(...args);
      return args[1].includes('?where=')?{Invoices:[{...f.foreign,...changed}]}:result;
    };
    await assert.rejects(executeCampaignBatch(f.dependencies),/identity evidence is incomplete/);assert.equal(f.posts,0);
  }
});

test('sales draft preflight retains global invoice number conflicts across different Contacts',async()=>{
  const f=draftFixture();const original=f.dependencies.accountingFetch;
  f.dependencies.accountingFetch=async(...args)=>{
    const result=await original(...args);
    if(args[1].includes('?where=')){
      assert.equal(new URL(`https://fixture.invalid${args[1]}`).searchParams.get('where'),'InvoiceNumber=="INV-1"');
      return {Invoices:[{...f.target,Contact:{ContactID:'99999999-9999-4999-8999-999999999999'}}]};
    }return result;
  };
  await assert.rejects(executeCampaignBatch(f.dependencies),/now exists/);assert.equal(f.posts,0);
});
