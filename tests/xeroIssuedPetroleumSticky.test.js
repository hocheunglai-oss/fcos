import assert from 'node:assert/strict';
import test from 'node:test';
import { currentIssuedPetroleumMatches } from '../api/_xeroIssuedPetroleumSticky.js';
import { buildFinancialClassifications } from '../api/_xeroFinancialSync.js';
import { buildGroupedPreservationContext } from '../api/_xeroGroupedPreservationAdapter.js';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function fixture() {
  const f = issuedPetroleumFixture();
  const proof = f.build();
  assert.equal(proof.eligible, true, JSON.stringify(proof.blockers));
  const refresh = () => {
    const built = buildFinancialClassifications(f.salesforce, f.xero, f.stored, { postingMode: 'draft' });
    const context = buildGroupedPreservationContext(f.salesforce, f.xero, f.stored, built.sources);
    context.issuedPetroleumCurrent = { suppliers: f.salesforce.suppliers, lines: f.salesforce.lines,
      extras: f.salesforce.extras, products: f.salesforce.productRecords };
    return { source: built.sources[0], context, row: built.rows[0] };
  };
  const accept = () => f.stored.documentMappings.push({ id: uuid(90), salesforce_object: f.source.salesforceObject,
    salesforce_id: f.source.salesforceId, xero_document_id: f.candidate.id, xero_document_type: f.candidate.type,
    xero_contact_id: f.candidate.contactId, source_fingerprint: f.source.sourceFingerprint,
    financial_fingerprint: f.source.financialFingerprint, protected_legacy: true,
    retained_differences: { accountId: f.source.accountId, stemId: f.source.stemId, differences: [],
      issuedSupplierPreservation: { policyVersion: proof.policyVersion, fingerprint: proof.fingerprint,
        evidenceFingerprint: proof.evidenceFingerprint, evidence: structuredClone(proof.evidence), reviewedXero: structuredClone(f.candidate) } } });
  return { ...f, proof, refresh, accept, matches: () => {
    const { source, context } = refresh(); return currentIssuedPetroleumMatches(source, context, proof);
  } };
}

test('actual issued petroleum proof accepts unchanged current raw facts without granting file readiness', () => {
  const f = fixture();
  const snapshot = JSON.stringify({ source: f.source, raw: f.raw, stored: f.stored, proof: f.proof });
  assert.equal(f.matches(), true);
  assert.equal(f.source.readiness.ready, false);
  assert.equal(JSON.stringify({ source: f.source, raw: f.raw, stored: f.stored, proof: f.proof }), snapshot);
  f.accept();
  const row = f.refresh().row;
  assert.equal(row.status, 'protected'); assert.equal(row.acceptedLegacy, true); assert.equal(row.proposedPayload, null);
});

test('Unit_Buy_At-only drift evades legacy hashes but is held by strict current petroleum evidence', () => {
  const f = fixture(); f.accept();
  const before = f.refresh();
  f.child.Unit_Buy_At__c += 1;
  const after = f.refresh();
  assert.equal(after.source.sourceFingerprint, before.source.sourceFingerprint);
  assert.equal(after.source.financialFingerprint, before.source.financialFingerprint);
  assert.notEqual(after.source.groupedAccounting.lines[0].unitAmount, before.source.groupedAccounting.lines[0].unitAmount);
  assert.equal(currentIssuedPetroleumMatches(after.source, after.context, f.proof), false);
  assert.equal(after.row.status, 'blocked'); assert.equal(after.row.proposedPayload, null);
  assert.ok(after.row.blockers.some((message) => message.includes('immutable preservation link')));
});

test('changed raw delivery identity and exact economics hold an accepted pointer without accounting fallback', async (t) => {
  const changes = [
    ['original supplier', (f) => { f.child.Original_Supplier__c = '001000000000002'; }],
    ['missing original supplier', (f) => { delete f.child.Original_Supplier__c; }],
    ['child moves to another STEM', (f) => { f.child.STEM__c = 'a0H000000000002'; }],
    ['vessel identity', (f) => { f.supplier.STEM__r.Vessel__c = 'a0V000000000002'; }],
    ['vessel name', (f) => { f.supplier.STEM__r.Vessel__r.Name = 'VESSEL TWO'; }],
    ['missing vessel identity', (f) => { delete f.supplier.STEM__r.Vessel__c; }],
    ['missing vessel name', (f) => { delete f.supplier.STEM__r.Vessel__r; }],
    ['delivery date', (f) => { f.supplier.STEM__r.Delivery_Date__c = '2026-03-18'; }],
    ['STEM key', (f) => { f.supplier.STEM__r.KeyStem__c = 'HK2626002T'; }],
    ['Product record type', (f) => { f.product.RecordType.DeveloperName = 'Trustee_Cost'; }],
    ['missing Product record type', (f) => { delete f.product.RecordType; }],
    ['Product removed', (f) => { f.salesforce.productRecords = []; }],
    ['duplicate current Product', (f) => { f.salesforce.productRecords.push(structuredClone(f.product)); }],
    ['Product name', (f) => { f.product.Name = 'OTHER FUEL'; }],
    ['BDN quantity', (f) => { f.child.Quantity_Delivered_Per_BDN__c += 1; }],
    ['zero BDN with ordinary quantity fallback', (f) => { f.child.Quantity_Delivered_Per_BDN__c = 0; }],
    ['missing BDN with ordinary quantity fallback', (f) => { f.child.Quantity_Delivered_Per_BDN__c = null; }],
    ['missing buy price', (f) => { f.child.Unit_Buy_At__c = null; }],
    ['line total', (f) => { f.child.Total_Cost__c += 0.01; }],
    ['unit', (f) => { f.child.Unit_of_Measure__c = 'L'; }],
    ['cancelled child', (f) => { f.child.Cancelled__c = true; }],
    ['missing cancellation fact', (f) => { delete f.child.Cancelled__c; }],
    ['deleted child', (f) => { f.child.IsDeleted = true; }],
    ['deleted parent', (f) => { f.supplier.IsDeleted = true; }],
    ['duplicate parent', (f) => { f.salesforce.suppliers.push(structuredClone(f.supplier)); }],
    ['duplicate child', (f) => { f.salesforce.lines.push(structuredClone(f.child)); }],
    ['additional extra', (f) => { f.salesforce.extras.push({ Id: 'a08000000000001', Supplier_Invoice__c: f.ids.source }); }],
    ['child raw currency', (f) => { f.child.CurrencyIsoCode = 'SGD'; }],
  ];
  for (const [name, change] of changes) await t.test(name, () => {
    const f = fixture(); f.accept(); change(f);
    assert.equal(f.matches(), false, name);
    const row = f.refresh().row;
    assert.equal(row.status, 'blocked', name); assert.equal(row.proposedPayload, null, name);
  });
});

test('current approved petroleum mapping identity, revision and approval must still match the receipt', async (t) => {
  const changes = [
    ['revision', (m) => { m.revision += 1; }],
    ['mapping identity', (m) => { m.id = uuid(80); }],
    ['disabled', (m) => { m.enabled = false; }],
    ['account', (m) => { m.xero_account_code = '51106'; }],
    ['tax', (m) => { m.xero_tax_type = 'INPUT'; }],
    ['approver identity', (m) => { m.approved_by = uuid(81); }],
    ['approval removed', (m) => { m.approved_by = null; }],
    ['approver email', (m) => { m.approved_by_email = 'other@example.test'; }],
    ['empty approval email', (m) => { m.approved_by_email = ' '; }],
    ['approval timestamp', (m) => { m.approved_at = '2026-09-02T00:00:00.000Z'; }],
    ['approval date removed', (m) => { m.approved_at = null; }],
  ];
  for (const [name, change] of changes) await t.test(name, () => {
    const f = fixture(); f.accept(); change(f.stored.productMappings[0]);
    assert.equal(f.matches(), false); assert.equal(f.refresh().row.status, 'blocked');
  });
  await t.test('duplicate mapping', () => {
    const f = fixture(); f.stored.productMappings.push(structuredClone(f.stored.productMappings[0]));
    assert.equal(f.matches(), false);
  });
});

test('complete current Account and Contact identity is required even for a stored acceptance', async (t) => {
  const changes = [
    ['Account ambiguity', (f) => { f.salesforce.groupedAccountSnapshot.accounts.push({ ...f.salesforce.groupedAccountSnapshot.accounts[0], id: '001000000000002' }); }],
    ['Contact ambiguity', (f) => { f.xero.contacts.push({ ...f.xero.contacts[0], id: uuid(82) }); }],
    ['Contact archived', (f) => { f.xero.contacts[0].status = 'ARCHIVED'; }],
    ['Account suspended', (f) => { f.salesforce.groupedAccountSnapshot.accounts[0].inactiveSuspended = true; }],
    ['Account active fact missing', (f) => { delete f.salesforce.groupedAccountSnapshot.accounts[0].inactiveSuspended; }],
    ['Account name', (f) => { f.salesforce.groupedAccountSnapshot.accounts[0].name = 'DIFFERENT COMPANY'; }],
    ['Account snapshot incomplete', (f) => { f.salesforce.groupedAccountSnapshot.complete = false; }],
    ['Contact snapshot incomplete', (f) => { f.xero.contactsComplete = false; }],
    ['tenant', (f) => { f.xero.tenantId = uuid(83); }],
    ['base currency', (f) => { f.xero.organisation.baseCurrency = 'SGD'; }],
  ];
  for (const [name, change] of changes) await t.test(name, () => {
    const f = fixture(); f.accept(); change(f);
    assert.equal(f.matches(), false); assert.equal(f.refresh().row.status, 'blocked');
  });
});

test('incomplete facts, other source holds and corrupt proof fail closed without throwing', async (t) => {
  const changes = [
    ['missing raw scope', (_s, c) => { delete c.issuedPetroleumCurrent; }],
    ['missing supplier scope', (_s, c) => { c.issuedPetroleumCurrent.suppliers = null; }],
    ['missing extra scope', (_s, c) => { delete c.issuedPetroleumCurrent.extras; }],
    ['missing membership', (_s, c) => { c.members = new Map(); }],
    ['missing matching function', (_s, c) => { c.matchesFor = null; }],
    ['unexpected identity error', (_s, c) => { c.matchesFor = () => { throw new Error('incomplete'); }; }],
    ['other source hold', (s) => { s.blockers.push('Current dispute needs review.'); }],
    ['other readiness hold', (s) => { s.readiness.blockers.push('Source is not authorised.'); }],
    ['missing child links', (s) => { s.readiness.linkedChildren = []; }],
    ['missing strict line', (s) => { s.groupedAccounting.lines = []; }],
    ['altered proof', (_s, _c, p) => { p.evidence.accounting.deliveryIdentity.unitAmount = '1'; }],
    ['wrong proof policy', (_s, _c, p) => { p.policyVersion = 'issued_supplier_preserve_v1'; }],
    ['missing proof', (_s, _c, p) => { delete p.evidence; }],
  ];
  for (const [name, change] of changes) await t.test(name, () => {
    const f = fixture(); const { source, context } = f.refresh(); const proof = structuredClone(f.proof);
    change(source, context, proof); assert.equal(currentIssuedPetroleumMatches(source, context, proof), false);
  });
  assert.equal(currentIssuedPetroleumMatches(null, null, null), false);
});

test('observation timestamps and equivalent decimal spelling do not change the accepted economics', () => {
  const f = fixture();
  f.child.LastModifiedDate = '2026-09-28T01:00:00.000Z'; f.supplier.LastModifiedDate = '2026-09-28T01:00:00.000Z';
  assert.equal(f.matches(), true);
  const { source, context } = f.refresh();
  f.child.Unit_Buy_At__c = '856.8240'; f.child.Quantity_Delivered_Per_BDN__c = '1993.2170';
  assert.equal(currentIssuedPetroleumMatches(source, context, f.proof), true);
});
