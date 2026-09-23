import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { allFinancialRows, buildFinancialClassifications, financialPreviewChanges, xeroFinancialSyncRun, XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';
import { isFinalSettlement } from '../src/lib/disputeWorkflowPresentation.js';
import { createDisputeSettlementEvidenceHandlers, loadDisputeSettlementEvidence } from '../api/_disputeSettlementEvidence.js';

function database(tables) {
  const calls = [];
  return { calls, from(table) {
    const filters = []; let values; let operation = 'select'; let start = 0; let end = Infinity; let single = false;
    const query = {
      select() { return query; }, order() { return query; }, range(a, b) { start = a; end = b; return query; },
      eq(key, value) { filters.push((row) => row[key] === value); return query; },
      in(key, list) { filters.push((row) => list.includes(row[key])); return query; },
      maybeSingle() { single = true; return query; },
      update(next) { values = next; operation = 'update'; return query; },
      upsert(next) { values = next; operation = 'upsert'; return query; },
      insert(next) { values = next; operation = 'insert'; return query; },
      then(resolve, reject) {
        try {
          const matches = (tables[table] || []).filter((row) => filters.every((filter) => filter(row))).slice(start, end + 1);
          if (operation === 'update') matches.forEach((row) => Object.assign(row, values));
          if (operation === 'insert' || operation === 'upsert') (tables[table] ||= []).push(values);
          return Promise.resolve({ data: single ? matches[0] || null : matches }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    }; return query;
  }, async rpc(name, args) {
    calls.push({ name, args });
    const run = tables.xero_financial_sync_runs[0];
    assert.equal(args.p_expected_revision, run.revision);
    if (name.startsWith('authorise_')) {
      run.status = 'authorised';
      for (const row of tables.xero_financial_sync_items) if (args.p_selected_item_ids.includes(row.id)) { row.selected = true; row.status = 'selected'; }
    } else if (name.startsWith('start_')) { assert.ok(['authorised', 'partial', 'failed'].includes(run.status)); run.status = 'processing'; }
    else run.status = args.p_status;
    run.revision += 1;
    return { data: { ...run } };
  } };
}
function fixture(postingMode = 'draft') {
  const runId = randomUUID();
  const salesforce = { buyers: [1, 2].map((i) => ({ Id: `invoice-${i}`, Name: `INV-${i}`, CurrencyIsoCode: 'USD', File__c: '069000000000001AAA', Proforma__c: false, Deprecated__c: false, Amount__c: 100, Invoice_Date__c: '2026-09-01', Invoice_Due_Date__c: '2026-09-30', STEM__c: `stem-${i}`, STEM__r: { Name: `STEM-${i}`, Account__c: `buyer-${i}`, Account__r: { Name: `Buyer ${i}` } } })),
    suppliers: [], extras: [], lines: [1, 2].map((i) => ({ Id: `line-${i}`, Buyer_Invoice__c: `invoice-${i}`, Product__c: 'product', Product__r: { Name: 'Fuel' }, Quantity__c: 1, Price_Per_Unit__c: 100, Total_Price__c: 100 })) };
  const xero = { documents: [], inactiveDocuments: [], contacts: [1, 2].map((i) => ({ id: `contact-${i}`, name: `Buyer ${i}`, status: 'ACTIVE' })), organisation: { baseCurrency: 'USD' } };
  const mapping = { id: 'mapping', enabled: true, direction: 'buyer', salesforce_product_id: 'product', xero_account_code: '200', xero_tax_type: 'NONE' };
  const classified = buildFinancialClassifications(salesforce, xero, { productMappings: [mapping], documentMappings: [] }, { postingMode });
  assert.ok(classified.rows.every((row) => row.action === 'create_draft' && row.status === 'eligible'));
  const items = classified.rows.map((row, i) => ({ id: randomUUID(), run_id: runId, row_index: i, status: 'eligible', selected: false,
    source_payload: row, proposed_action: row.action, proposed_payload: row.proposedPayload, xero_payload: {}, blockers: [], differences: [] }));
  const tables = { xero_financial_sync_runs: [{ id: runId, revision: 1, status: 'ready_for_review', control_totals: { postingMode } }], xero_financial_sync_items: items,
    xero_financial_product_mappings: [mapping], xero_financial_document_mappings: [] };
  const client = database(tables); const writes = [];
  const dependencies = { client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, getConnection: async () => ({ scope: 'accounting.invoices accounting.contacts accounting.settings.read' }),
    loadSalesforce: async () => salesforce, loadXero: async () => xero,
    accountingFetch: async (_connection, path, options) => {
      writes.push({ path, ...options });
      return { Invoices: options.body.Invoices.map((invoice) => ({
        InvoiceID: `00000000-0000-4000-8000-${invoice.InvoiceNumber === 'INV-1' ? '000000000001' : '000000000002'}`,
        Type: 'ACCREC', InvoiceNumber: invoice.InvoiceNumber, Contact: { ContactID: invoice.Contact.ContactID },
        CurrencyCode: 'USD', Status: invoice.Status, Total: 100, Date: invoice.Date, DueDate: invoice.DueDate,
        Reference: invoice.Reference, LineItems: invoice.LineItems,
      })) };
    } };
  return { runId, tables, items, client, dependencies, salesforce, xero, writes,
    request: { runId, revision: 1, reviewed: true, selectedItemIds: items.map((row) => row.id) } };
}

test('one confirmation persists approval before sync and keeps successful rows on resume', async () => {
  const f = fixture();
  const result = await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(result.run.status, 'completed');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].body.Invoices.length, 2);
  assert.deepEqual(f.client.calls.map((row) => row.name.split('_')[0]), ['authorise', 'start', 'finish']);
  assert.ok(f.items.every((row) => row.status === 'created'));
  f.tables.xero_financial_sync_runs[0].status = 'partial';
  await xeroFinancialSyncRun({ runId: f.runId, revision: result.run.revision }, f.dependencies);
  assert.equal(f.writes.length, 1, 'resuming does not send completed transactions again');
});

test('authorised document batch records identities correctly when Xero returns rows in another order', async () => {
  const f = fixture('authorised'); const send = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (...args) => { const response = await send(...args); return { Invoices: response.Invoices.reverse() }; };
  const result = await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(result.run.status, 'completed');
  assert.equal(f.items[0].xero_document_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(f.items[1].xero_document_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(f.tables.xero_financial_document_mappings.length, 2);
});

test('unconfirmed authorised responses never store mappings or replay on resume', async () => {
  for (const changes of [{ Total: undefined }, { Total: 101 }, { Contact: {} }, { CurrencyCode: 'HKD' },
    { Type: 'ACCPAY' }, { Status: 'DRAFT' }, { InvoiceNumber: 'OTHER' }, { InvoiceID: undefined }]) {
    const f = fixture('authorised'); const send = f.dependencies.accountingFetch;
    f.dependencies.accountingFetch = async (...args) => {
      const response = await send(...args); Object.assign(response.Invoices[0], changes); return response;
    };
    const result = await xeroFinancialSyncRun(f.request, f.dependencies);
    assert.equal(result.run.status, 'partial'); assert.equal(f.items[0].status, 'failed');
    assert.equal(f.items[0].error_code, 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN');
    assert.equal(f.tables.xero_financial_document_mappings.length, 1);
    assert.equal(f.tables.xero_financial_document_mappings[0].salesforce_id, 'invoice-2');
    const resumed = await xeroFinancialSyncRun({ runId: f.runId, revision: result.run.revision }, f.dependencies);
    assert.equal(f.writes.length, 1, 'an uncertain posting is never repeated from the same preview');
    assert.equal(resumed.outcomes[0].reviewRequired, true);
  }
});

test('duplicate response transaction IDs cannot link distinct Salesforce documents', async () => {
  const f = fixture('authorised'); const send = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (...args) => {
    const response = await send(...args); response.Invoices[1].InvoiceID = response.Invoices[0].InvoiceID; return response;
  };
  const result = await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(result.run.status, 'partial'); assert.ok(f.items.every((row) => row.status === 'failed'));
  assert.equal(f.tables.xero_financial_document_mappings.length, 0);
});

test('an authorised update response with another transaction ID cannot replace the reviewed mapping', async () => {
  const f = fixture('authorised');
  f.xero.documents = f.items.map((item, index) => {
    const source = item.source_payload;
    return { id: `00000000-0000-4000-8000-00000000000${index + 1}`, type: 'ACCREC', collection: 'Invoices',
      status: 'DRAFT', amountDue: 100, amountPaid: 0, amountCredited: 0, total: 100, currency: 'USD', contactId: source.contactId,
      invoiceNumber: source.documentNumber, date: source.invoiceDate, dueDate: source.dueDate, reference: source.reference,
      lineItems: source.lines.map((line) => ({ LineItemID: `line-${index}`, Description: line.description, Quantity: line.quantity,
        UnitAmount: line.unitAmount, AccountCode: line.accountCode, TaxType: line.taxType })) };
  });
  const preview = buildFinancialClassifications(f.salesforce, f.xero, { productMappings: f.tables.xero_financial_product_mappings,
    documentMappings: [] }, { postingMode: 'authorised' });
  assert.ok(preview.rows.every((row) => row.action === 'safe_update' && row.status === 'eligible'));
  f.items.forEach((item, index) => Object.assign(item, { source_payload: preview.rows[index], proposed_action: 'safe_update',
    proposed_payload: preview.rows[index].proposedPayload, xero_payload: preview.rows[index].xero, differences: preview.rows[index].differences }));
  const send = f.dependencies.accountingFetch;
  f.dependencies.accountingFetch = async (...args) => {
    const response = await send(...args); response.Invoices[0].InvoiceID = '99999999-9999-4999-8999-999999999999'; return response;
  };
  const result = await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(result.run.status, 'partial'); assert.equal(f.items[0].error_code, 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN');
  assert.equal(f.items[1].status, 'updated'); assert.equal(f.tables.xero_financial_document_mappings.length, 1);
  assert.equal(f.tables.xero_financial_document_mappings[0].salesforce_id, 'invoice-2');
});

test('a changed source is isolated while the unchanged approved document proceeds', async () => {
  const f = fixture(); f.salesforce.buyers[0].Invoice_Due_Date__c = '2026-10-01';
  const result = await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(result.run.status, 'partial');
  assert.equal(result.outcomes.filter((row) => row.reviewRequired).length, 1);
  assert.deepEqual(f.writes[0].body.Invoices.map((row) => row.InvoiceNumber), ['INV-2']);
  assert.equal(f.items[0].error_code, 'XERO_FINANCIAL_REVIEW_CHANGED');
});

test('connection failure after approval creates a resumable failed run', async () => {
  const f = fixture();
  await assert.rejects(xeroFinancialSyncRun(f.request, { ...f.dependencies, getConnection: async () => { throw new Error('connection unavailable'); } }), /connection unavailable/);
  assert.equal(f.tables.xero_financial_sync_runs[0].status, 'failed');
  assert.equal(f.writes.length, 0);
  const result = await xeroFinancialSyncRun({ runId: f.runId, revision: f.tables.xero_financial_sync_runs[0].revision }, f.dependencies);
  assert.equal(result.run.status, 'completed');
  assert.equal(f.client.calls.filter((row) => row.name.startsWith('authorise_')).length, 1);
});

test('disabled financial gate prevents even authorisation in the combined action', async () => {
  const f = fixture();
  await assert.rejects(xeroFinancialSyncRun(f.request, { ...f.dependencies, env: {} }), /disabled|enabled|gate/i);
  assert.equal(f.client.calls.length, 0);
  assert.equal(f.writes.length, 0);
});

test('saved mappings retrieve every page rather than silently stopping at 1000 rows', async () => {
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  assert.equal((await allFinancialRows(database({ rows }), 'rows')).data.length, 1203);
});

test('background check uses modified-since and detects source, lock and aged snapshots', async () => {
  const id = randomUUID(); const controls = { bankMappings: [], documentMappings: [], productMappings: [] };
  const run = { id, source_snapshot_at: '2026-09-15T10:00:00Z', control_totals: { workflowSnapshot: {
    reconciliationVersion: XERO_RECONCILIATION_VERSION, controlsFingerprint: createHash('sha256').update(JSON.stringify(controls)).digest('hex'), organisation: { periodLockDate: null, endOfYearLockDate: null, baseCurrency: null },
  } } };
  const calls = []; const deps = { client: database({ xero_financial_sync_runs: [run] }), connection: {}, now: Date.parse('2026-09-15T10:10:00Z'),
    querySalesforce: async () => Array.from({ length: 8 }, () => ({ records: [] })),
    accountingFetch: async (_connection, path, options) => {
      calls.push({ path, options });
      options.onResponse({ headers: new Headers({ 'X-DayLimit-Remaining': String(1000 - calls.length) }) });
      const name = path.split('?')[0].slice(1);
      return { [name]: name === 'Organisations' ? [{}] : [] };
    } };
  const unchanged = await financialPreviewChanges(id, deps);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.rateLimit.dayRemaining, 995);
  assert.equal(unchanged.rateLimit.dayResetAt, null);
  assert.equal(calls.length, 5);
  assert.ok(calls.slice(0, 4).every(({ options }) => options.headers['If-Modified-Since'] === 'Tue, 15 Sep 2026 10:00:00 GMT'));
  assert.equal((await financialPreviewChanges(id, { ...deps, querySalesforce: async () => [{ records: [{ Id: 'changed' }] }] })).changed, true);
  assert.equal((await financialPreviewChanges(id, { ...deps, now: Date.parse('2026-09-16T10:00:00Z') })).changed, true);
});

test('combined closure is offered only on the final action or invoice instruction', () => {
  const actions = [{ id: 'a', accountingStatus: 'Settled' }, { id: 'b', accountingStatus: 'Pending Accounting' }];
  assert.equal(isFinalSettlement({ actionId: 'a', actions }), false);
  assert.equal(isFinalSettlement({ actionId: 'b', actions }), true);
  const instructions = [{ id: 'i1', actionId: 'b', status: 'Settled' }, { id: 'i2', actionId: 'b', status: 'Instruction Issued' }];
  assert.equal(isFinalSettlement({ instructionId: 'i1', actions, instructions }), false);
  assert.equal(isFinalSettlement({ instructionId: 'i2', actions, instructions }), true);
});

test('settlement evidence is scoped to one authorised action and refreshed before saving', async () => {
  const action = { id: 'action', case_id: 'case', party_id: 'party' };
  const context = { client: database({ dispute_beta_actions: [action] }), profile: {} };
  const checks = [];
  const handlers = createDisputeSettlementEvidenceHandlers({
    requireActiveUser: async () => context,
    requireCapability: async (_client, _profile, capability) => checks.push(capability),
    getDisputeBetaCase: async () => ({ id: 'case', stem_id: 'stem' }),
    requireInterofficeStemAccess: async (id) => checks.push(id),
    loadCurrentDisputeStem: async () => ({ Id: 'stem' }),
    loadDisputeWorkflowActions: async () => ({ actionRows: [action], instructionRows: [], partyRows: [{ id: 'party' }] }),
    assertValidDisputeParties: () => checks.push('parties'),
    appError: (message, status) => Object.assign(new Error(message), { status }),
    loadEvidence: async () => ({ candidates: [{ id: 'credit', fingerprint: 'current', reference: 'CN-1', date: '2026-09-15', amount: 20 }] }),
  });
  const input = { actionId: 'action', evidenceId: 'credit', evidenceFingerprint: 'current', settlementAmount: 999, verifiedEvidence: { reference: 'forged' } };
  const verified = await handlers.verifiedSettlementInput(input, {}, context);
  assert.equal(verified.settlementAmount, 20);
  assert.equal(verified.settlementReference, 'CN-1');
  assert.deepEqual(checks, ['disputes_account', 'stem', 'parties']);
  await assert.rejects(handlers.verifiedSettlementInput({ ...input, evidenceFingerprint: 'old' }, {}, context), /evidence changed/);
  await assert.rejects(handlers.verifiedSettlementInput({ ...input, instructionId: 'other-invoice' }, {}, context), /exactly one/);
  assert.equal((await handlers.verifiedSettlementInput({ actionId: 'action', verifiedEvidence: { reference: 'forged' } }, {}, context)).verifiedEvidence, undefined);
});

test('USD credit evidence cannot settle a different currency or closing action', async () => {
  for (const action of [{ action_type: 'issue_buyer_credit_note', currency_iso_code: 'HKD', amount: 20 },
    { action_type: 'close_buyer_dispute', currency_iso_code: 'USD', amount: 20 }]) {
    assert.deepEqual(await loadDisputeSettlementEvidence({ stem: {}, action, party: {} }, { client: {} }), { candidates: [] });
  }
});

test('reviewed protected legacy differences are linked without Xero writes and remain accepted only while evidence is unchanged', async () => {
  const f = fixture();
  f.xero.documents = f.salesforce.buyers.map((record, index) => ({ id: `xero-${index}`, type: 'ACCREC', collection: 'Invoices',
    status: 'PAID', amountDue: 0, amountPaid: 100, amountCredited: 0, total: 100, currency: 'USD', contactId: `contact-${index + 1}`,
    invoiceNumber: record.Name, date: '2026-08-31', dueDate: '2026-08-31', reference: 'Historical reference',
    lineItems: [{ Description: 'Legacy line', Quantity: 1, UnitAmount: 100, AccountCode: '200', TaxType: 'NONE' }] }));
  const classify = () => buildFinancialClassifications(f.salesforce, f.xero, { productMappings: f.tables.xero_financial_product_mappings, documentMappings: f.tables.xero_financial_document_mappings });
  const preview = classify();
  assert.ok(preview.rows.every(row => row.reviewRequired && row.action === 'protected_legacy' && row.status === 'eligible' && row.proposedPayload === null));
  f.items.forEach((item, index) => Object.assign(item, { source_payload: preview.rows[index], proposed_action: 'protected_legacy', proposed_payload: {}, xero_payload: preview.rows[index].xero, differences: preview.rows[index].differences }));
  await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(f.writes.length, 0, 'Finance acceptance never rewrites protected Xero accounting history');
  assert.equal(f.tables.xero_financial_document_mappings.length, 2);
  assert.ok(f.tables.xero_financial_document_mappings.every(row => row.retained_differences.accountId && row.retained_differences.reviewFingerprint));
  const refreshed = classify();
  assert.ok(refreshed.rows.every(row => row.acceptedLegacy && !row.reviewRequired && row.differences.length > 0));
  f.xero.documents[0].reference = 'Changed after review';
  assert.equal(classify().rows[0].reviewRequired, true);
  f.xero.documents[1].lineItems[0].AccountCode = '999';
  assert.ok(classify().rows[1].blockers.length);
});

test('old saved rule versions force a complete new check without using old selections', async () => {
  const id = randomUUID();
  const result = await financialPreviewChanges(id, { client: database({ xero_financial_sync_runs: [{ id,
    source_snapshot_at: new Date().toISOString(), control_totals: { workflowSnapshot: { controlsFingerprint: 'old' } } }] }), connection: {},
    querySalesforce: async () => { throw new Error('Old classifications should invalidate before probing providers'); } });
  assert.equal(result.changed, true);
});


test('authorised runs apply the exact persisted mode and never promote a reviewed draft by request override', async () => {
  const f = fixture('authorised');
  const result = await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(result.run.status, 'completed');
  assert.equal(result.run.postingMode, 'authorised');
  assert.ok(f.writes[0].body.Invoices.every((row) => row.Status === 'AUTHORISED'));
  const draft = fixture();
  await assert.rejects(xeroFinancialSyncRun({ ...draft.request, postingMode: 'authorised' }, draft.dependencies), { code: 'XERO_FINANCIAL_POSTING_MODE_CHANGED' });
  assert.equal(draft.writes.length, 0); assert.equal(draft.client.calls.length, 0);
});

test('readiness changed after authorised preview blocks only that selected record before Xero writes', async () => {
  const f = fixture('authorised'); f.salesforce.buyers[0].File__c = null;
  const result = await xeroFinancialSyncRun(f.request, f.dependencies);
  assert.equal(result.run.status, 'partial');
  assert.deepEqual(f.writes[0].body.Invoices.map((row) => row.InvoiceNumber), ['INV-2']);
  assert.equal(f.items[0].error_code, 'XERO_FINANCIAL_REVIEW_CHANGED');
  assert.match(f.items[0].error_message, /issued source file/);
});
