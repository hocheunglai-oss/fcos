import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialClassifications, buildXeroAccountingPayload, xeroFinancialSyncRun } from '../api/_xeroFinancialSync.js';
import { buildGroupedPreservationContext } from '../api/_xeroGroupedPreservationAdapter.js';
import { evaluateIssuedSupplierFinancialDocument } from '../api/_xeroIssuedSupplierPreservationAdapter.js';
import { issuedSupplierHash, issuedSupplierAccountingFingerprint } from '../api/_xeroIssuedSupplierPreservation.js';
import { issuedSupplierWorkflowFixture, issuedSupplierRoundedWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { evaluatePetroleumFinancialDocument } from '../api/_xeroIssuedPetroleumPreservationAdapter.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const clone = (value) => structuredClone(value);

function acceptedFixture(petroleum = false, rounded = false) {
  const f = petroleum ? issuedPetroleumFixture() : rounded ? issuedSupplierRoundedWorkflowFixture() : issuedSupplierWorkflowFixture();
  const unlinked = buildFinancialClassifications(f.salesforce, f.xero, f.stored, { postingMode: 'draft' });
  const source = unlinked.sources[0];
  if (!petroleum) source.issuedSupplierVessel = f.vessels.get(source.salesforceId).vessel;
  const context = buildGroupedPreservationContext(f.salesforce, f.xero, f.stored, unlinked.sources);
  if (petroleum) context.petroleum = f.scope;
  const proof = (petroleum ? evaluatePetroleumFinancialDocument : evaluateIssuedSupplierFinancialDocument)(source, f.candidate, context, f.fileEvidence);
  assert.equal(proof.eligible, true, JSON.stringify(proof.blockers));
  const mapping = { id: uuid(90), salesforce_object: source.salesforceObject, salesforce_id: source.salesforceId,
    xero_document_id: f.candidate.id, xero_document_type: f.candidate.type, xero_contact_id: f.candidate.contactId,
    source_fingerprint: source.sourceFingerprint, financial_fingerprint: source.financialFingerprint, protected_legacy: true,
    retained_differences: { accountId: source.accountId, stemId: source.stemId, differences: clone(unlinked.rows[0].differences),
      issuedSupplierPreservation: { policyVersion: proof.policyVersion, fingerprint: proof.fingerprint,
        evidenceFingerprint: proof.evidenceFingerprint, evidence: clone(proof.evidence), reviewedXero: clone(f.candidate) } } };
  f.stored.documentMappings.push(mapping);
  return { ...f, mapping, proof, source,
    classify: () => buildFinancialClassifications(f.salesforce, f.xero, f.stored, { postingMode: 'draft' }).rows[0] };
}

function assertNoAccountingFallback(row) {
  assert.equal(row.proposedPayload, null);
  assert.ok(!['safe_update', 'create_draft'].includes(row.action));
  assert.equal(Object.hasOwn(row, 'issuedSupplierPreservation'), true);
}

test('unchanged accepted issued supplier mapping stays protected and retains every Xero detail', () => {
  const f = acceptedFixture(); const before = clone(f.candidate);
  const row = f.classify();
  assert.equal(row.action, 'protected_legacy'); assert.equal(row.status, 'protected');
  assert.equal(row.acceptedLegacy, true); assert.equal(row.reviewRequired, false);
  assert.deepEqual(row.blockers, []); assert.equal(row.readiness.ready, false);
  assert.deepEqual(row.differences, f.mapping.retained_differences.differences);
  assert.deepEqual(row.xero, before); assert.deepEqual(f.candidate, before);
  assertNoAccountingFallback(row);
});

test('only observation timestamp drift preserves an unchanged historical acceptance', () => {
  const f = acceptedFixture(); f.candidate.updatedDateUTC = '/Date(1790000000000+0000)/';
  const row = f.classify(); assert.equal(row.status, 'protected'); assert.equal(row.acceptedLegacy, true);
  assertNoAccountingFallback(row);
});

test('accepted petroleum links remain protected after ordinary checks and never permit accounting updates', () => {
  const f = acceptedFixture(true);
  const row = f.classify();
  assert.equal(row.status, 'protected'); assert.equal(row.acceptedLegacy, true);
  assert.equal(row.issuedSupplierPreservation.policyVersion, 'issued_petroleum_preserve_v1');
  assert.deepEqual(row.xero, f.candidate); assertNoAccountingFallback(row);
  assert.notEqual(f.source.invoiceDate, f.candidate.date, 'historical delivery date remains unchanged');
  for (const change of [
    (item) => { item.candidate.amountPaid = 1; item.candidate.amountDue -= 1; },
    (item) => { item.candidate.invoiceNumber = item.source.documentNumber; },
    (item) => { item.child.Quantity_Delivered_Per_BDN__c += 1; },
    (item) => { item.mapping.retained_differences.issuedSupplierPreservation.policyVersion = 'issued_supplier_preserve_v1'; },
  ]) {
    const altered = acceptedFixture(true); change(altered);
    const result = altered.classify(); assert.equal(result.status, 'blocked'); assertNoAccountingFallback(result);
  }
});

test('new raw petroleum identity observations preserve previously calculated legacy hashes', () => {
  const f = issuedPetroleumFixture();
  const original = buildFinancialClassifications(f.salesforce, f.xero, f.stored).sources[0];
  delete f.child.Original_Supplier__c;
  delete f.supplier.STEM__r.Vessel__c;
  delete f.supplier.STEM__r.Vessel__r;
  const priorShape = buildFinancialClassifications(f.salesforce, f.xero, f.stored).sources[0];
  assert.equal(original.sourceFingerprint, priorShape.sourceFingerprint);
  assert.equal(original.financialFingerprint, priorShape.financialFingerprint);
});

test('corrupt acceptance and source or target changes remain blocked without accounting fallback', async (t) => {
  const changes = [
    ['null proof', (f) => { f.mapping.retained_differences.issuedSupplierPreservation = null; }],
    ['false proof', (f) => { f.mapping.retained_differences.issuedSupplierPreservation = false; }],
    ['empty proof', (f) => { f.mapping.retained_differences.issuedSupplierPreservation = {}; }],
    ['wrong proof version', (f) => { f.mapping.retained_differences.issuedSupplierPreservation.policyVersion = 'unsupported'; }],
    ['corrupt proof accounting', (f) => { f.mapping.retained_differences.issuedSupplierPreservation.evidence.accounting.source.totalCents = '1'; }],
    ['corrupt proof observation', (f) => { f.mapping.retained_differences.issuedSupplierPreservation.evidence.observations.amountPaidCents = '1'; }],
    ['missing reviewed Xero', (f) => { delete f.mapping.retained_differences.issuedSupplierPreservation.reviewedXero; }],
    ['removed protected flag', (f) => { f.mapping.protected_legacy = false; }],
    ['changed accepted Account', (f) => { f.mapping.retained_differences.accountId = '001000000000002'; }],
    ['changed source economic amount', (f) => { f.supplier.Invoice_Amount__c = 125.2; f.child.Line_Total_Buy__c = 125.2; }],
    ['changed raw source units', (f) => { f.child.Unit_Cost__c = 0.6; }],
    ['changed source Account', (f) => { f.supplier.Supplier__c = '001000000000002'; }],
    ['changed mapped accounting code', (f) => { f.stored.productMappings[0].xero_account_code = '51100'; }],
    ['target Contact changed', (f) => { f.candidate.contactId = uuid(80); }],
    ['current Contact name no longer resolves', (f) => { f.xero.contacts[0].name = 'Other counterparty'; }],
    ['target LineItemID replaced', (f) => { f.candidate.lineItems[0].LineItemID = uuid(81); }],
    ['target description changed', (f) => { f.candidate.lineItems[0].Description = 'Altered history'; }],
    ['target due date changed', (f) => { f.candidate.dueDate = '2026-02-03'; }],
    ['target number becomes source number', (f) => { f.candidate.invoiceNumber = f.supplier.Name; }],
    ['target settlement changes', (f) => { f.candidate.amountPaid = 1; f.candidate.amountDue = 123.2; }],
    ['target raw accounting treatment changes', (f) => { f.candidate.groupedAccounting.lineAmountTypes = 'NoTax'; }],
    ['target raw unowned metadata changes', (f) => { f.candidate.unowned.CurrencyRate = 2; }],
    ['target becomes PAID', (f) => { f.candidate.status = 'PAID'; f.candidate.amountDue = 0; f.candidate.amountPaid = 124.2; }],
    ['target becomes DRAFT', (f) => { f.candidate.status = 'DRAFT'; }],
    ['target becomes VOIDED', (f) => { f.candidate.status = 'VOIDED'; }],
    ['target disappears', (f) => { f.xero.documents = []; }],
  ];
  for (const [name, change] of changes) await t.test(name, () => {
    const f = acceptedFixture(); change(f);
    const row = f.classify(); assert.equal(row.status, 'blocked', name); assert.equal(row.action, 'blocked', name);
    assert.ok(row.blockers.length > 0); assertNoAccountingFallback(row);
  });
});

test('missing accepted target cannot be reassigned to a new matching invoice', () => {
  const f = acceptedFixture();
  f.xero.documents = [{ ...clone(f.candidate), id: uuid(82), invoiceNumber: f.supplier.Name }];
  const row = f.classify(); assert.equal(row.status, 'blocked'); assert.equal(row.xero, null);
  assertNoAccountingFallback(row);
});

test('accounting payload construction refuses every present issued-preservation marker', async (t) => {
  for (const marker of [{ policyVersion: 'issued_supplier_preserve_v1' }, { policyVersion: 'issued_petroleum_preserve_v1' }, { policyVersion: 'unknown' }, {}, null, false, 'corrupt']) {
    await t.test(JSON.stringify(marker), () => {
      const f = acceptedFixture();
      assert.throws(() => buildXeroAccountingPayload({ ...f.source, issuedSupplierPreservation: marker }, f.candidate.id, 'AUTHORISED', f.candidate),
        { code: 'XERO_ISSUED_PRESERVATION_LINK_ONLY' });
    });
  }
});

test('generic financial runner rejects a preservation run before authorisation or any provider work', async (t) => {
  for (const policy of ['issued_supplier_preserve_v1', 'issued_petroleum_preserve_v1', 'unknown']) for (const reviewed of [false, true]) await t.test(`${policy} reviewed=${reviewed}`, async () => {
    const runId = uuid(60); const events = [];
    const forbidden = (name) => async () => { events.push(name); throw new Error(`Forbidden ${name}`); };
    const client = {
      from(table) {
        assert.equal(table, 'xero_financial_sync_runs'); events.push('run_lookup');
        const query = { select(value) { assert.equal(value, 'control_totals'); return query; },
          eq(key, value) { assert.equal(key, 'id'); assert.equal(value, runId); return query; },
          maybeSingle: async () => ({ data: { control_totals: { preservationPolicy: policy } }, error: null }) };
        return query;
      },
      rpc: forbidden('authorise_or_start_rpc'),
    };
    await assert.rejects(xeroFinancialSyncRun({ runId, revision: 1, reviewed, selectedItemIds: [uuid(61)] }, {
      client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
      accessContext: { profile: { id: uuid(62), email: 'finance@example.test' } },
      getConnection: forbidden('connection'), loadSalesforce: forbidden('salesforce'), loadXero: forbidden('xero'),
      accountingFetch: forbidden('accounting_write'), fetchImpl: forbidden('fetch'),
    }), { code: 'XERO_ISSUED_PRESERVATION_LINK_ONLY' });
    assert.deepEqual(events, ['run_lookup']);
  });
});


test('rounded trustee acceptance remains preserve-only and rejects rehashed or same-cent drift', async (t) => {
  const original = acceptedFixture(false, true);
  assert.equal(original.classify().status, 'protected'); assertNoAccountingFallback(original.classify());
  for (const [name, change] of [
    ['raw source changes within same cent', (f) => { f.child.Line_Total_Buy__c = 124.196; }],
    ['strip marker', (_f, proof) => { delete proof.evidence.accounting.source.lines[0].centRounding; }],
    ['unknown marker', (_f, proof) => { proof.evidence.accounting.source.lines[0].centRounding.policy = 'unknown'; }],
    ['null proof line', (_f, proof) => { proof.evidence.accounting.source.lines[0] = null; }],
    ['null marker', (_f, proof) => { proof.evidence.accounting.source.lines[0].centRounding = null; }],
    ['changed raw proof', (_f, proof) => { proof.evidence.accounting.source.lines[0].centRounding.rawLineAmount = '124.196'; }],
    ['extra marker fields', (_f, proof) => { proof.evidence.accounting.source.lines[0].centRounding.extra = true; }],
    ['changed quantity', (_f, proof) => { proof.evidence.accounting.source.lines[0].quantity = '248.392'; }],
  ]) await t.test(name, () => {
    const f = acceptedFixture(false, true); const proof = f.mapping.retained_differences.issuedSupplierPreservation;
    change(f, proof); proof.fingerprint = issuedSupplierAccountingFingerprint(proof.evidence); proof.evidenceFingerprint = issuedSupplierHash(proof.evidence);
    const result = f.classify(); assert.equal(result.status, 'blocked'); assertNoAccountingFallback(result);
  });
});
