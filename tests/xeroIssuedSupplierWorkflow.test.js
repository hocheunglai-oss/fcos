import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { xeroFinancialDocumentPreservationPreview as preview, xeroFinancialDocumentPreservationRun as run } from '../api/_xeroIssuedSupplierWorkflow.js';
import { issuedSupplierWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';
import { issuedPetroleumFixture, issuedPetroleumOwnerFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { collectPetroleumPreservationScope } from '../api/_xeroIssuedPetroleumScope.js';
import { normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';
import { issuedPetroleumV2Fixture } from './xeroIssuedPetroleumV2Fixtures.js';

const actor = { id: '00000000-0000-4000-8000-000000000099', email: 'finance@example.com' };
const copy = (value) => structuredClone(value);

function cohortFixture() {
  const f = issuedSupplierWorkflowFixture();
  const second = issuedSupplierWorkflowFixture();
  const source = 'a06000000000002', stem = 'a0H000000000002', child = 'a04000000000002';
  const document = '069000000000002', version = '068000000000002', target = '00000000-0000-4000-8000-000000000030';
  Object.assign(second.supplier, { Id: source, Name: 'M2601011', STEM__c: stem, STEM__r: { ...second.supplier.STEM__r, Name: 'HK2524198T - SEA OTHER - SINGAPORE', KeyStem__c: 'HK2524198T' } });
  Object.assign(second.child, { Id: child, Supplier_Invoice__c: source, STEM__c: stem });
  Object.assign(second.candidate, { id: target, invoiceNumber: '79118PT-SEA OTHER' });
  second.candidate.lineItems[0].LineItemID = '00000000-0000-4000-8000-000000000040';
  Object.assign(second.fileEvidence, { parentId: source, documentId: document, versionId: version });
  Object.assign(second.fileEvidence.link, { id: '06A000000000002', parentId: source, documentId: document });
  Object.assign(second.fileEvidence.version, { id: version, documentId: document, latestPublishedVersionId: version });
  Object.assign(second.fileEvidence.review, { sourceNumber: 'M2601011', printedNumber: 'M-26-01-011', vessel: 'SEA OTHER' });
  second.fileEvidence.review.lines.forEach((line) => { line.description = line.description.replaceAll('SEA STELLAR', 'SEA OTHER'); });
  f.salesforce.suppliers.push(second.supplier); f.salesforce.extras.push(second.child); f.xero.documents.push(second.candidate);
  f.files.set(source, second.fileEvidence); f.vessels.set(source, { stemId: stem, vessel: 'SEA OTHER' });
  f.packet.records.push({ sourceId: source, xeroDocumentId: target, documentId: document, versionId: version,
    sha256: second.fileEvidence.sha256, review: second.fileEvidence.review });
  f.second = second;
  return f;
}

function harness(f = issuedSupplierWorkflowFixture()) {
  const v2 = f.packet.policyVersion === 'issued_petroleum_preserve_v2';
  const petroleum = v2 || f.packet.policyVersion === 'issued_petroleum_preserve_v1';
  const linkRpc = v2 ? 'link_xero_issued_petroleum_document_v2' : petroleum ? 'link_xero_issued_petroleum_document_v1' : 'link_xero_issued_supplier_document_v1';
  const eventType = petroleum ? 'issued_petroleum_document_preservation_linked' : 'issued_supplier_document_preservation_linked';
  const calls = [], tables = { xero_financial_sync_runs: [], xero_financial_sync_items: [], dispute_beta_cases: [],
    xero_financial_document_mappings: [], xero_financial_audit_events: [] };
  const controls = { barrier: false, linkFailureAt: 0, uncertainAt: 0, commitUncertain: false };
  let linkCount = 0;
  const client = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
      const filters = []; let order; let max = Infinity; let single = false;
      const query = {
        select() { return query; }, eq(key, value) { filters.push((row) => row[key] === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        order(key) { order = key; return query; }, limit(value) { max = value; return query; }, maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          calls.push({ type: 'read', table });
          let data = tables[table].filter((row) => filters.every((filter) => filter(row)));
          if (order) data = data.toSorted((a, b) => a[order] - b[order]);
          data = copy(data.slice(0, max));
          return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, body) {
      calls.push({ type: 'rpc', name, body: copy(body) });
      const saved = tables.xero_financial_sync_runs.find((row) => row.id === body.p_run_id);
      if (name === 'persist_xero_financial_preview_v1') {
        const savedRun = { ...copy(body.p_run), status: 'ready_for_review' };
        const items = copy(body.p_items).map((item) => ({ ...item, mutation_attempts: 0 }));
        tables.xero_financial_sync_runs.push(savedRun); tables.xero_financial_sync_items.push(...items);
        return { data: { run: copy(savedRun), items: items.map(({ row_key, id }) => ({ row_key, id })), reused: false }, error: null };
      }
      const items = tables.xero_financial_sync_items.filter((row) => row.run_id === body.p_run_id);
      if (name === 'authorise_xero_financial_sync_run_v1') {
        assert.equal(saved.revision, body.p_expected_revision);
        Object.assign(saved, { status: 'authorised', revision: saved.revision + 1, reviewed_by: body.p_actor_id,
          reviewed_by_email: body.p_actor_email, reviewed_at: '2026-09-28T00:00:00.000Z' });
        items.forEach((item) => { if (body.p_selected_item_ids.includes(item.id)) Object.assign(item, { selected: true, status: 'selected' }); });
        return { data: copy(saved), error: null };
      }
      if (name === 'start_xero_financial_sync_run_v1') {
        if (controls.barrier) return { data: null, error: { code: '40001' } };
        Object.assign(saved, { status: 'processing', revision: saved.revision + 1 });
        controls.afterStart?.(items);
        return { data: copy(saved), error: null };
      }
      if (name === 'finish_xero_financial_sync_run_v1') {
        Object.assign(saved, { status: body.p_status, revision: saved.revision + 1 });
        return { data: copy(saved), error: null };
      }
      assert.equal(name, linkRpc, 'Only the policy-specific link RPC is allowed');
      linkCount += 1;
      if (controls.linkFailureAt === linkCount) return { data: null, error: { code: '40001' } };
      const uncertain = controls.uncertainAt === linkCount;
      if (uncertain && !controls.commitUncertain) throw new TypeError('Connection lost before the outcome was received');
      const item = items.find((row) => row.id === body.p_item_id);
      const source = item.source_payload, target = item.xero_payload;
      assert.equal(body.p_expected_run_revision, saved.revision);
      assert.equal(body.p_expected_item_updated_at, item.updated_at);
      assert.equal(body.p_actor_id, actor.id); assert.equal(body.p_actor_email, actor.email);
      assert.equal(body.p_tenant_id, f.ids.tenant);
      const acceptance = { runId: saved.id, itemId: item.id, runRevision: saved.revision, itemUpdatedAt: item.updated_at,
        actorId: actor.id, actorEmail: actor.email };
      const proof = { ...copy(body.p_review), acceptance, reviewedXero: copy(target) };
      delete proof.accountingCanonical; delete proof.evidenceCanonical;
      const mapping = { id: randomUUID(), salesforce_object: item.source_object, salesforce_id: source.salesforceId,
        salesforce_document_number: source.documentNumber, document_kind: source.documentKind, xero_document_type: source.xeroType,
        xero_document_id: item.xero_document_id, xero_document_number: target.invoiceNumber, xero_contact_id: target.contactId,
        xero_status: 'AUTHORISED', source_fingerprint: source.sourceFingerprint, financial_fingerprint: source.financialFingerprint,
        protected_legacy: true, retained_differences: { differences: item.differences, stemId: source.stemId, accountId: source.accountId,
          reviewFingerprint: body.p_review.legacyReviewFingerprint, issuedSupplierPreservation: proof } };
      tables.xero_financial_document_mappings.push(mapping);
      tables.xero_financial_audit_events.push({ run_id: saved.id, event_type: eventType, outcome: 'success',
        actor_id: actor.id, actor_email: actor.email, record_counts: { linked: 1, applied: 0, financialWrites: 0 },
        fingerprints: { tenantId: f.ids.tenant, itemId: item.id, mappingId: mapping.id, issuedSupplierPreservation: proof } });
      Object.assign(item, { status: 'linked', applied_at: '2026-09-28T00:01:00.000Z', updated_at: '2026-09-28T00:01:00.000Z' });
      if (uncertain) throw new TypeError('Committed link response was lost');
      return { data: { id: item.id, status: 'linked', xeroDocumentId: item.xero_document_id, mappingId: mapping.id }, error: null };
    },
  };
  const read = (name, value) => async () => { calls.push({ type: 'provider', name }); return copy(value()); };
  const dependencies = { client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, accessContext: { profile: actor },
    fetchImpl: async () => { assert.fail('No arbitrary provider fetch or financial mutation is permitted'); },
    getConnection: read('connection', () => ({ tenantId: f.ids.tenant })), collectFiles: read('files', () => f.files),
    loadSalesforce: read('salesforce', () => f.salesforce), loadXero: read('xero', () => f.xero),
    loadControls: read('controls', () => f.stored), collectVessels: read('vessels', () => f.vessels),
    collectPetroleumScope: read('petroleum_scope', () => f.scope) };
  return { f, tables, calls, controls, dependencies,
    preview: () => preview({ packet: f.packet }, dependencies),
    body: (result) => ({ runId: result.run.id, revision: result.run.revision, selectedItemIds: result.rows.map((row) => row.id), reviewed: true }) };
}

function petroleumSevenHarness() {
  const f = issuedPetroleumFixture();
  const rawInvoices = [f.raw];
  for (let n = 2; n <= 7; n += 1) {
    const other = issuedPetroleumFixture();
    const sourceId = `a0600000000000${n}`, stemId = `a0H00000000000${n}`, childId = `a0500000000000${n}`;
    const documentId = `06900000000000${n}`, versionId = `06800000000000${n}`;
    const targetId = `00000000-0000-4000-8000-00000000003${n}`;
    Object.assign(other.supplier, { Id: sourceId, Name: `PET2600${n}`, STEM__c: stemId });
    Object.assign(other.supplier.STEM__r, { KeyStem__c: `HK262600${n}T`, Name: `HK262600${n}T - VESSEL ${n}`,
      Vessel__c: `a0V00000000000${n}`, Vessel__r: { Name: `VESSEL ${n}` } });
    Object.assign(other.child, { Id: childId, Supplier_Invoice__c: sourceId, STEM__c: stemId });
    Object.assign(other.raw, { InvoiceID: targetId, InvoiceNumber: `7971${n}P-VESSEL ${n}` });
    other.raw.LineItems[0].LineItemID = `00000000-0000-4000-8000-00000000004${n}`;
    // Interleave unselected holds to detect accidental positional result matching.
    if ([2, 5].includes(n)) other.raw.LineItems[0].Tracking = [{ Name: 'Job', Option: 'EXISTING' }];
    Object.assign(other.fileEvidence, { parentId: sourceId, documentId, versionId });
    Object.assign(other.fileEvidence.link, { id: `06A00000000000${n}`, parentId: sourceId, documentId });
    Object.assign(other.fileEvidence.version, { id: versionId, documentId, latestPublishedVersionId: versionId });
    Object.assign(other.fileEvidence.review, { sourceNumber: `PET2600${n}`, printedNumber: `PET-26-00${n}`, vessel: `VESSEL ${n}` });
    f.salesforce.suppliers.push(other.supplier); f.salesforce.lines.push(other.child);
    rawInvoices.push(other.raw); f.xero.documents.push(normalizeXeroInvoice(other.raw));
    f.files.set(sourceId, other.fileEvidence);
    f.packet.records.push({ sourceId, xeroDocumentId: targetId, documentId, versionId,
      sha256: other.fileEvidence.sha256, review: other.fileEvidence.review });
  }
  const h = harness(f), scopes = [], reads = [], requestScopes = [];
  const complete = records => ({ records: copy(records), totalSize: records.length, done: true });
  const query = async (soql, options) => {
    reads.push({ kind: 'salesforce', soql, options });
    if (soql.includes('FROM Organization')) return complete([{ Id: f.fileEvidence.orgId, IsSandbox: false }]);
    if (soql.includes('FROM Supplier_Invoice__c')) return complete(f.salesforce.suppliers);
    if (soql.includes('FROM STEM_Line_Item__c')) {
      const selected = /Supplier_Invoice__c IN \(([^)]+)\)/.exec(soql)?.[1] || '';
      return complete(f.salesforce.lines.filter(row => selected.includes(`'${row.Supplier_Invoice__c}'`)));
    }
    if (soql.includes('FROM STEM_Extra_Cost__c')) return complete([]);
    assert.match(soql, /FROM Product2/); return complete([f.product]);
  };
  h.dependencies.collectPetroleumScope = async input => {
    requestScopes.push(copy(input.records));
    const scope = await collectPetroleumPreservationScope(input, { query, queryAll: query,
      accountingFetch: async (_connection, path, options) => {
        reads.push({ kind: 'xero', path, method: options.method });
        assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
        if (path.startsWith('/Invoices?')) return { Invoices: copy(rawInvoices) };
        if (path.startsWith('/CreditNotes?')) return { CreditNotes: [] };
        if (path === '/Accounts') return { Accounts: f.scope.accountTax.accounts };
        assert.equal(path, '/TaxRates'); return { TaxRates: f.scope.accountTax.taxRates };
      } });
    scopes.push(scope); return scope;
  };
  return { ...h, scopes, reads, requestScopes, rawInvoices };
}

test('real singleton collector retains seven-row evidence coverage while linking only five eligible selected rows', async () => {
  const h = petroleumSevenHarness(); const before = copy({ salesforce: h.f.salesforce, xero: h.f.xero });
  const review = await h.preview();
  const eligible = review.rows.filter(row => row.status === 'eligible'); const blocked = review.rows.filter(row => row.status === 'blocked');
  assert.equal(eligible.length, 5); assert.equal(blocked.length, 2);
  assert(blocked.every(row => row.blockers.some(reason => /LINE_UNSUPPORTED/.test(reason))));
  const body = { ...h.body(review), selectedItemIds: eligible.map(row => row.id).reverse() };
  const result = await run(body, h.dependencies);
  assert.equal(result.run.status, 'completed'); assert.equal(result.financialWrites, 0); assert.equal(result.outcomes.length, 5);
  assert.equal(h.scopes.length, 2); assert.deepEqual(h.requestScopes[1], h.requestScopes[0]);
  assert.equal(h.scopes[0].sourceFacts.size, 7); assert.equal(h.scopes[1].sourceFacts.size, 7);
  assert.equal(h.scopes[0].coverage.contentFingerprint, h.scopes[1].coverage.contentFingerprint);
  assert.deepEqual(h.scopes[0].coverage.queryFingerprints, h.scopes[1].coverage.queryFingerprints);
  assert.equal(h.tables.xero_financial_document_mappings.length, 5);
  for (const row of eligible) {
    const item = h.tables.xero_financial_sync_items.find(item => item.id === row.id);
    const mapping = h.tables.xero_financial_document_mappings.find(mapping => mapping.salesforce_id === row.sourceId);
    assert.equal(mapping.xero_document_id, row.xeroDocumentId);
    const proof = mapping.retained_differences.issuedSupplierPreservation;
    assert.equal(proof.evidence.accounting.identityOwnershipPolicy, undefined, 'singleton batch scope must be exercised');
    assert.equal(proof.fingerprint, item.source_payload.issuedSupplierPreservation.fingerprint);
    assert.deepEqual(proof.reviewedXero, item.xero_payload);
  }
  for (const row of blocked) {
    const item = h.tables.xero_financial_sync_items.find(item => item.id === row.id);
    assert.equal(item.selected, false); assert.equal(item.status, 'blocked'); assert.equal(item.applied_at ?? null, null);
    assert.equal(item.mutation_attempts, 0);
  }
  assert.deepEqual({ salesforce: h.f.salesforce, xero: h.f.xero }, before);
  assert.equal(h.calls.filter(call => call.name === 'link_xero_issued_petroleum_document_v1').length, 5);
  h.calls.length = 0;
  const replay = await run(body, h.dependencies);
  assert.equal(replay.outcomes.length, 5); assert(replay.outcomes.every(row => row.alreadyLinked));
  assert.equal(h.calls.some(call => call.type === 'provider' || call.type === 'rpc'), false);
});

test('original full preview rows cannot be removed, duplicated, retargeted or changed when a subset is selected', async t => {
  for (const [name, mutate] of [
    ['missing unselected row', h => { h.tables.xero_financial_sync_items.splice(1, 1); }],
    ['duplicate item identity', h => { h.tables.xero_financial_sync_items[1].id = h.tables.xero_financial_sync_items[0].id; }],
    ['changed unselected source identity', h => { h.tables.xero_financial_sync_items[1].source_id = 'a06000000000009'; }],
    ['changed unselected target identity', h => { h.tables.xero_financial_sync_items[1].xero_document_id = randomUUID(); }],
    ['duplicate request', h => { h.tables.xero_financial_sync_items[1].source_payload.issuedSupplierRequest = copy(h.tables.xero_financial_sync_items[0].source_payload.issuedSupplierRequest); }],
    ['changed unselected review', h => { h.tables.xero_financial_sync_items[1].source_payload.issuedSupplierRequest.sha256 = '0'.repeat(64); }],
    ['changed row ordering', h => { h.tables.xero_financial_sync_items[1].row_index = 0; }],
  ]) await t.test(name, async () => {
    const h = petroleumSevenHarness(); const review = await h.preview();
    const body = { ...h.body(review), selectedItemIds: review.rows.filter(row => row.status === 'eligible').map(row => row.id) };
    mutate(h); h.calls.length = 0;
    await assert.rejects(run(body, h.dependencies));
    assert.equal(h.calls.some(call => call.type === 'provider' || call.type === 'rpc'), false);
    assert.equal(h.tables.xero_financial_document_mappings.length, 0);
  });
});

test('subset revalidation detects scope races and last-selected provider drift before the first link', async t => {
  for (const [name, mutate] of [
    ['scope row removed after start', h => { h.controls.afterStart = () => h.tables.xero_financial_sync_items.splice(1, 1); }],
    ['scope target changed after start', h => { h.controls.afterStart = items => { items[1].xero_document_id = randomUUID(); }; }],
    ['last selected target changed', h => { h.rawInvoices[6].DueDate = '2026-03-19'; Object.assign(h.f.xero.documents[6], normalizeXeroInvoice(h.rawInvoices[6])); }],
    ['selected current target missing', h => { h.f.xero.documents.pop(); }],
    ['unselected current target missing', h => { h.f.xero.documents.splice(1, 1); }],
  ]) await t.test(name, async () => {
    const h = petroleumSevenHarness(); const review = await h.preview();
    const body = { ...h.body(review), selectedItemIds: review.rows.filter(row => row.status === 'eligible').map(row => row.id) };
    mutate(h); h.calls.length = 0;
    await assert.rejects(run(body, h.dependencies));
    assert.equal(h.calls.some(call => call.name === 'link_xero_issued_petroleum_document_v1'), false);
    assert.equal(h.tables.xero_financial_document_mappings.length, 0);
    assert.equal(h.tables.xero_financial_sync_runs[0].status, 'failed');
  });
});

test('actual preview keeps ordinary readiness false and performs no source or Xero mutation', async () => {
  const h = harness(); const before = copy({ salesforce: h.f.salesforce, xero: h.f.xero });
  const result = await h.preview();
  assert.equal(result.run.status, 'ready_for_review'); assert.equal(result.rows[0].status, 'eligible');
  assert.equal(result.financialWrites, 0);
  assert.equal(h.tables.xero_financial_sync_items[0].source_payload.readiness.ready, false);
  assert.deepEqual({ salesforce: h.f.salesforce, xero: h.f.xero }, before);
  assert.deepEqual(h.calls.filter((call) => call.type === 'rpc').map((call) => call.name), ['persist_xero_financial_preview_v1']);
  assert.equal(h.tables.xero_financial_document_mappings.length, 0);
});

test('petroleum workflow uses its complete historical scope and distinct transaction while retaining original bill details', async () => {
  const h = harness(issuedPetroleumFixture()); const before = copy(h.f.candidate);
  const result = await h.preview();
  assert.equal(result.rows[0].status, 'eligible', JSON.stringify(result.rows[0].blockers));
  assert.equal(h.tables.xero_financial_sync_runs[0].control_totals.preservationPolicy, 'issued_petroleum_preserve_v1');
  const source = h.tables.xero_financial_sync_items[0].source_payload;
  assert.equal(source.readiness.ready, false);
  assert.notEqual(source.invoiceDate, before.date);
  assert.equal(h.calls.some((call) => call.name === 'vessels'), false);
  assert.equal(h.calls.filter((call) => call.name === 'petroleum_scope').length, 1);
  const response = await run(h.body(result), h.dependencies);
  assert.equal(response.financialWrites, 0); assert.equal(response.outcomes[0].status, 'linked');
  assert.equal(h.calls.filter((call) => call.name === 'petroleum_scope').length, 2);
  const proof = h.tables.xero_financial_document_mappings[0].retained_differences.issuedSupplierPreservation;
  assert.equal(proof.policyVersion, 'issued_petroleum_preserve_v1');
  assert.equal(proof.evidence.accounting.deliveryIdentity.deliveryDate, before.date);
  assert.deepEqual(proof.reviewedXero, before);
  assert.deepEqual(h.f.candidate, before);
  assert.equal(h.calls.some((call) => call.name === 'link_xero_issued_supplier_document_v1'), false);
  h.calls.length = 0;
  const again = await run(h.body(result), h.dependencies);
  assert.equal(again.outcomes[0].alreadyLinked, true);
  assert.equal(h.calls.some((call) => call.type === 'provider' || call.type === 'rpc'), false);
  h.tables.xero_financial_audit_events[0].event_type = 'issued_supplier_document_preservation_linked';
  await assert.rejects(run(h.body(result), h.dependencies), /immutable audit receipt/);
});

test('petroleum scope drift and absent current mapping approval abort before the first link', async () => {
  for (const mutate of [
    (h) => { h.f.scope.coverage.targetComplete = false; },
    (h) => { h.f.scope.sourceClaims.push({ ...copy(h.f.supplier), Id: 'a06000000000002' }); h.f.refreshScope(); },
    (h) => { h.f.child.Quantity_Delivered_Per_BDN__c = 0; h.f.refreshScope(); },
    (h) => { h.f.stored.productMappings[0].approved_at = null; },
  ]) {
    const h = harness(issuedPetroleumFixture()); const result = await h.preview();
    assert.equal(result.rows[0].status, 'eligible'); mutate(h); h.calls.length = 0;
    await assert.rejects(run(h.body(result), h.dependencies), /changed/);
    assert.equal(h.tables.xero_financial_document_mappings.length, 0);
    assert.equal(h.calls.some((call) => call.name === 'link_xero_issued_petroleum_document_v1'), false);
  }
});

test('v2 links only the reviewed immutable attachment facts and retains every original Xero field', async () => {
  const h = harness(issuedPetroleumV2Fixture());
  const before = copy({ salesforce: h.f.salesforce, xero: h.f.xero });
  const result = await h.preview();
  assert.equal(result.rows[0].status, 'eligible', JSON.stringify(result.rows[0].blockers));
  assert.equal(h.tables.xero_financial_sync_runs[0].control_totals.preservationPolicy, 'issued_petroleum_preserve_v2');
  const response = await run(h.body(result), h.dependencies);
  assert.equal(response.financialWrites, 0);
  assert.equal(response.outcomes[0].status, 'linked');
  assert.equal(h.calls.filter((call) => call.name === 'link_xero_issued_petroleum_document_v2').length, 1);
  const proof = h.tables.xero_financial_document_mappings[0].retained_differences.issuedSupplierPreservation;
  const file = proof.evidence.accounting.issuedFile;
  assert.equal(proof.policyVersion, 'issued_petroleum_preserve_v2');
  assert.equal(file.review.invoiceDate, null); assert.equal(file.review.dueDate, null);
  assert.equal(file.review.lines[0].unit, 'MTS');
  assert.deepEqual(file.attachmentManifest.entries, h.f.packet.records[0].attachments);
  assert.deepEqual(proof.reviewedXero, h.f.candidate);
  assert.deepEqual({ salesforce: h.f.salesforce, xero: h.f.xero }, before);
  h.calls.length = 0;
  assert.equal((await run(h.body(result), h.dependencies)).outcomes[0].alreadyLinked, true);
  assert.equal(h.calls.some((call) => call.type === 'provider' || call.type === 'rpc'), false);
});

test('v2 supporting attachment changes abort the entire selected link before accounting or mapping writes', async () => {
  for (const mutate of [
    (f) => { f.fileEvidence.attachmentManifest.entries[1].sha256 = '0'.repeat(64); },
    (f) => { f.fileEvidence.attachmentManifest.entries[1].role = 'credit_note'; },
    (f) => { f.fileEvidence.attachmentManifest.entries.pop(); },
    (f) => { f.fileEvidence.review.invoiceDate = f.supplier.Invoice_Date__c; },
  ]) {
    const h = harness(issuedPetroleumV2Fixture()); const result = await h.preview();
    assert.equal(result.rows[0].status, 'eligible'); mutate(h.f); h.calls.length = 0;
    await assert.rejects(run(h.body(result), h.dependencies));
    assert.equal(h.calls.some((call) => call.name === 'link_xero_issued_petroleum_document_v2'), false);
    assert.equal(h.tables.xero_financial_document_mappings.length, 0);
  }
});

test('real historical collector preserves an eligible selection when a different reviewed row is disputed', async () => {
  const f = issuedPetroleumOwnerFixture();
  const second = issuedPetroleumFixture();
  const sourceId = 'a06000000000002', stemId = 'a0H000000000002', childId = 'a05000000000002';
  const documentId = '069000000000002', versionId = '068000000000002';
  const targetId = '00000000-0000-4000-8000-000000000030';
  Object.assign(second.supplier, { Id: sourceId, Name: 'PET26002', STEM__c: stemId });
  Object.assign(second.supplier.STEM__r, { KeyStem__c: 'HK2626002T', Name: 'HK2626002T - VESSEL TWO',
    Vessel__c: 'a0V000000000002', Vessel__r: { Name: 'VESSEL TWO' } });
  Object.assign(second.child, { Id: childId, Supplier_Invoice__c: sourceId, STEM__c: stemId });
  Object.assign(second.raw, { InvoiceID: targetId, InvoiceNumber: '79717P-VESSEL TWO' });
  second.raw.LineItems[0].LineItemID = '00000000-0000-4000-8000-000000000040';
  Object.assign(second.fileEvidence, { parentId: sourceId, documentId, versionId });
  Object.assign(second.fileEvidence.link, { id: '06A000000000002', parentId: sourceId, documentId });
  Object.assign(second.fileEvidence.version, { id: versionId, documentId, latestPublishedVersionId: versionId });
  Object.assign(second.fileEvidence.review, { sourceNumber: 'PET26002', printedNumber: 'PET-26-002', vessel: 'VESSEL TWO' });
  f.salesforce.suppliers.push(second.supplier);
  f.salesforce.lines.push(second.child);
  f.xero.documents.push(normalizeXeroInvoice(second.raw));
  f.files.set(sourceId, second.fileEvidence);
  f.packet.records.push({ sourceId, xeroDocumentId: targetId, documentId, versionId,
    sha256: second.fileEvidence.sha256, review: second.fileEvidence.review });
  const h = harness(f), reads = [], collected = [];
  h.tables.dispute_beta_cases.push({ stem_id: stemId, workflow_status: 'open' });
  const complete = records => ({ records: copy(records), totalSize: records.length, done: true });
  const query = async (soql, options) => {
    reads.push({ kind: 'salesforce', soql, options });
    if (soql.includes('FROM Organization')) return complete([{ Id: f.fileEvidence.orgId, IsSandbox: false }]);
    if (soql.includes('FROM Supplier_Invoice__c')) return complete(f.salesforce.suppliers);
    if (soql.includes('FROM STEM_Line_Item__c')) {
      const selected = /Supplier_Invoice__c IN \(([^)]+)\)/.exec(soql)?.[1] || '';
      return complete(f.salesforce.lines.filter(row => selected.includes(`'${row.Supplier_Invoice__c}'`)));
    }
    if (soql.includes('FROM STEM_Extra_Cost__c')) return complete([]);
    assert.match(soql, /FROM Product2/);
    return complete([f.product]);
  };
  h.dependencies.collectPetroleumScope = async input => {
    const scope = await collectPetroleumPreservationScope(input, { query, queryAll: query,
      accountingFetch: async (_connection, path, options) => {
        reads.push({ kind: 'xero', path, method: options.method });
        assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
        if (path.startsWith('/Invoices?')) return { Invoices: copy([f.raw, second.raw]) };
        if (path.startsWith('/CreditNotes?')) return { CreditNotes: [] };
        if (path === '/Accounts') return { Accounts: f.scope.accountTax.accounts };
        assert.equal(path, '/TaxRates'); return { TaxRates: f.scope.accountTax.taxRates };
      } });
    collected.push(scope);
    return scope;
  };
  const before = copy(f.xero.documents);
  const review = await h.preview();
  assert.equal(review.rows[0].status, 'eligible', JSON.stringify(review.rows[0].blockers));
  assert.equal(review.rows[1].status, 'blocked');
  assert(review.rows[1].blockers.some(reason => /unresolved dispute/.test(reason)));
  const result = await run({ ...h.body(review), selectedItemIds: [review.rows[0].id] }, h.dependencies);
  assert.deepEqual(result.outcomes.map(row => row.status), ['linked']);
  assert.equal(result.financialWrites, 0);
  assert.equal(collected.length, 2, 'Preview and Run each perform real fresh historical collection');
  assert.equal(collected[0].sourceFacts.size, 2); assert.equal(collected[1].sourceFacts.size, 2);
  assert.equal(h.tables.xero_financial_document_mappings.length, 1);
  const receipt = h.tables.xero_financial_document_mappings[0].retained_differences.issuedSupplierPreservation;
  assert.equal(receipt.evidence.accounting.identityOwnershipPolicy, 'document_specific_inactive_source_owners_v1');
  assert.deepEqual(receipt.evidence.accounting.identityOwnership.sourceAccountIds, [f.ids.account, '001000000000002']);
  assert(reads.filter(row => row.kind === 'salesforce' && row.soql.includes('FROM Supplier_Invoice__c'))
    .every(row => row.soql.includes("'001000000000002'") && !/WHERE .*Invoice_Date__c/.test(row.soql)));
  assert.deepEqual(f.xero.documents, before);
  assert.equal(h.tables.xero_financial_sync_items.find(row => row.id === review.rows[1].id).status, 'blocked');
});

test('exact successful run persists complete proof, source/item identities and authenticated actor', async () => {
  const h = harness(); const result = await h.preview();
  const response = await run({ ...h.body(result), actor: { id: randomUUID(), email: 'spoof@example.com' } }, h.dependencies);
  assert.equal(response.run.status, 'completed'); assert.equal(response.financialWrites, 0);
  const mapping = h.tables.xero_financial_document_mappings[0], item = h.tables.xero_financial_sync_items[0];
  const proof = mapping.retained_differences.issuedSupplierPreservation;
  assert.equal(mapping.salesforce_id, h.f.ids.source); assert.equal(mapping.xero_document_id, h.f.ids.target);
  assert.equal(item.status, 'linked'); assert.equal(item.mutation_attempts, 0);
  assert.equal(proof.acceptance.actorId, actor.id); assert.equal(proof.acceptance.actorEmail, actor.email);
  assert.equal(proof.acceptance.itemId, item.id); assert.equal(proof.acceptance.runId, result.run.id);
  assert.equal(proof.evidence.accounting.issuedFile.sha256, h.f.fileEvidence.sha256);
  assert.equal(proof.evidence.accounting.xero.totalCents, '12420');
  assert.deepEqual(proof.reviewedXero, item.xero_payload);
  assert.deepEqual(h.tables.xero_financial_audit_events[0].record_counts, { linked: 1, applied: 0, financialWrites: 0 });
  assert.equal(h.tables.xero_financial_audit_events[0].actor_id, actor.id);
});

test('missing authentication rejects preview and execution before provider or storage reads', async () => {
  const h = harness(); const dependencies = { ...h.dependencies, accessContext: {} };
  await assert.rejects(preview({ packet: h.f.packet }, dependencies), { code: 'XERO_ISSUED_PRESERVATION_ACTOR_REQUIRED' });
  await assert.rejects(run({}, dependencies), { code: 'XERO_ISSUED_PRESERVATION_ACTOR_REQUIRED' });
  assert.equal(h.calls.length, 0);
});

test('unknown packet policies and cross-policy records fail before any provider work', async () => {
  for (const policyVersion of [null, false, '', 'unknown', 'issued_petroleum_preserve_v1']) {
    const h = harness();
    await assert.rejects(preview({ packet: { ...h.f.packet, policyVersion } }, h.dependencies));
    assert.equal(h.calls.length, 0);
  }
  const explicit = harness();
  const result = await preview({ packet: { ...explicit.f.packet, policyVersion: 'issued_supplier_preserve_v1' } }, explicit.dependencies);
  assert.equal(result.rows[0].status, 'eligible', 'explicit and legacy trustee packets share the original contract');
});

test('a saved policy change cannot dispatch trustee items through another link transaction', async () => {
  for (const policy of ['issued_petroleum_preserve_v1', 'unknown', null]) {
    const h = harness(); const result = await h.preview();
    h.tables.xero_financial_sync_runs[0].control_totals.preservationPolicy = policy;
    h.calls.length = 0;
    await assert.rejects(run(h.body(result), h.dependencies));
    assert.equal(h.calls.some((call) => call.type === 'provider' || call.type === 'rpc'), false);
  }
});

test('unrelated, duplicate or accounting-write selection is rejected before fresh evidence reads', async () => {
  for (const mode of ['unrelated', 'duplicate', 'mixed']) {
    const h = harness(); const result = await h.preview(); const body = h.body(result);
    if (mode === 'unrelated') body.selectedItemIds = [randomUUID()];
    if (mode === 'duplicate') body.selectedItemIds.push(body.selectedItemIds[0]);
    if (mode === 'mixed') h.tables.xero_financial_sync_items[0].proposed_action = 'safe_update';
    h.calls.length = 0;
    await assert.rejects(run(body, h.dependencies));
    assert.equal(h.calls.some((call) => call.type === 'provider' || call.type === 'rpc'), false);
  }
});

test('gate and global processing barrier precede all fresh evidence reads', async () => {
  for (const mode of ['gate', 'barrier']) {
    const h = harness(); const result = await h.preview(); h.calls.length = 0;
    if (mode === 'gate') h.dependencies.env.FCOS_ENABLE_XERO_FINANCIAL_SYNC = 'false'; else h.controls.barrier = true;
    await assert.rejects(run(h.body(result), h.dependencies));
    assert.equal(h.calls.some((call) => call.type === 'provider'), false);
    assert.equal(h.calls.some((call) => call.name === 'link_xero_issued_supplier_document_v1'), false);
    if (mode === 'gate') assert.equal(h.calls.length, 0);
  }
});

test('authorised barrier recovery requires the same actor, revision and exact saved selection', async () => {
  const h = harness(cohortFixture()); const result = await h.preview(); const body = h.body(result);
  h.controls.barrier = true;
  await assert.rejects(run(body, h.dependencies));
  const saved = h.tables.xero_financial_sync_runs[0];
  assert.equal(saved.status, 'authorised'); h.controls.barrier = false;
  const resume = { ...body, revision: saved.revision };
  for (const invalid of [{ ...body }, { ...resume, selectedItemIds: resume.selectedItemIds.slice(0, 1) }]) {
    await assert.rejects(run(invalid, h.dependencies));
  }
  await assert.rejects(run(resume, { ...h.dependencies, accessContext: { profile: { id: randomUUID(), email: 'other@example.com' } } }));
  const response = await run(resume, h.dependencies);
  assert.equal(response.run.status, 'completed'); assert.equal(response.outcomes.length, 2);
  assert.equal(h.calls.filter((call) => call.name === 'authorise_xero_financial_sync_run_v1').length, 1);
});

test('completed retries verify immutable mapping and audit receipts without another provider read or link', async () => {
  const h = harness(); const result = await h.preview(); const body = h.body(result);
  await run(body, h.dependencies); h.calls.length = 0;
  const response = await run(body, h.dependencies);
  assert.equal(response.outcomes[0].alreadyLinked, true);
  assert.equal(h.calls.some((call) => call.type === 'provider' || call.type === 'rpc'), false);
  assert.ok(h.calls.some((call) => call.table === 'xero_financial_document_mappings'));
  assert.ok(h.calls.some((call) => call.table === 'xero_financial_audit_events'));
  const mappings = copy(h.tables.xero_financial_document_mappings), audits = copy(h.tables.xero_financial_audit_events);
  for (const mode of ['mapping-missing', 'audit-missing', 'proof', 'audit-actor', 'audit-proof', 'mapping-fingerprint']) {
    h.tables.xero_financial_document_mappings = copy(mappings); h.tables.xero_financial_audit_events = copy(audits);
    if (mode === 'mapping-missing') h.tables.xero_financial_document_mappings = [];
    if (mode === 'audit-missing') h.tables.xero_financial_audit_events = [];
    if (mode === 'proof') h.tables.xero_financial_document_mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.issuedFile.sha256 = '0'.repeat(64);
    if (mode === 'audit-actor') h.tables.xero_financial_audit_events[0].actor_id = randomUUID();
    if (mode === 'audit-proof') h.tables.xero_financial_audit_events[0].fingerprints.issuedSupplierPreservation.evidenceFingerprint = '0'.repeat(64);
    if (mode === 'mapping-fingerprint') h.tables.xero_financial_document_mappings[0].source_fingerprint = '0'.repeat(64);
    await assert.rejects(run(body, h.dependencies), undefined, mode);
  }
});

test('provider, file, source, target and stored proof drift abort before any link', async () => {
  for (const mode of ['tenant', 'file', 'source', 'target', 'proof']) {
    const h = harness(); const result = await h.preview(); h.calls.length = 0;
    if (mode === 'tenant') { h.f.ids.tenant = randomUUID(); h.f.xero.tenantId = h.f.ids.tenant; }
    if (mode === 'file') h.f.fileEvidence.version.isLatest = false;
    if (mode === 'source') h.f.child.Unit_Cost__c = 0.6;
    if (mode === 'target') h.f.candidate.dueDate = '2026-01-06';
    if (mode === 'proof') h.tables.xero_financial_sync_items[0].source_payload.issuedSupplierReviewFingerprint = '0'.repeat(64);
    await assert.rejects(run(h.body(result), h.dependencies), undefined, mode);
    assert.equal(h.calls.some((call) => call.name === 'link_xero_issued_supplier_document_v1'), false, mode);
    assert.equal(h.tables.xero_financial_sync_runs[0].status, mode === 'proof' ? 'ready_for_review' : 'failed', mode);
  }
});

test('the complete selected cohort is rechecked before the first link', async () => {
  const h = harness(cohortFixture()); const result = await h.preview();
  assert.deepEqual(result.rows.map((row) => row.status), ['eligible', 'eligible']);
  h.f.second.child.Cancelled__c = true; h.calls.length = 0;
  await assert.rejects(run(h.body(result), h.dependencies));
  assert.equal(h.calls.some((call) => call.name === 'link_xero_issued_supplier_document_v1'), false);
  assert.equal(h.tables.xero_financial_document_mappings.length, 0);
});

test('confirmed partial transaction failure retains linked first item and cannot blindly retry', async () => {
  const h = harness(cohortFixture()); const result = await h.preview(); h.controls.linkFailureAt = 2;
  await assert.rejects(run(h.body(result), h.dependencies));
  assert.equal(h.tables.xero_financial_sync_runs[0].status, 'partial');
  assert.deepEqual(h.tables.xero_financial_sync_items.map((item) => item.status), ['linked', 'selected']);
  assert.equal(h.tables.xero_financial_document_mappings.length, 1);
  const links = h.calls.filter((call) => call.name === 'link_xero_issued_supplier_document_v1').length;
  await assert.rejects(run(h.body(result), h.dependencies));
  assert.equal(h.calls.filter((call) => call.name === 'link_xero_issued_supplier_document_v1').length, links);
});

test('uncertain RPC outcomes retain processing state and never retry the link automatically', async () => {
  for (const commitUncertain of [false, true]) {
    const h = harness(); const result = await h.preview(); h.controls.uncertainAt = 1; h.controls.commitUncertain = commitUncertain;
    await assert.rejects(run(h.body(result), h.dependencies));
    assert.equal(h.tables.xero_financial_sync_runs[0].status, 'processing');
    assert.equal(h.tables.xero_financial_document_mappings.length, commitUncertain ? 1 : 0);
    await assert.rejects(run(h.body(result), h.dependencies));
    assert.equal(h.calls.filter((call) => call.name === 'link_xero_issued_supplier_document_v1').length, 1);
    assert.equal(h.calls.some((call) => call.name === 'finish_xero_financial_sync_run_v1'), false);
  }
});
