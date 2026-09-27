import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { xeroFinancialDocumentPreservationPreview as preview, xeroFinancialDocumentPreservationRun as run } from '../api/_xeroIssuedSupplierWorkflow.js';
import { issuedSupplierWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';

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
  const petroleum = f.packet.policyVersion === 'issued_petroleum_preserve_v1';
  const linkRpc = petroleum ? 'link_xero_issued_petroleum_document_v1' : 'link_xero_issued_supplier_document_v1';
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
    assert.equal(h.tables.xero_financial_sync_runs[0].status, 'failed', mode);
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
