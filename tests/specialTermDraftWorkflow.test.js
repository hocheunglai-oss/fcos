import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { clauseHash, CLAUSE_LIST_STYLES, CLAUSE_PROJECTIONS } from '../api/_specialTermClauseModel.js';
import { localRevisionFromDetail, revisionPayload } from '../src/lib/specialTermRevision.js';
import { SPECIAL_TERM_PENDING_REASON } from '../shared/specialTermDraftPolicy.js';

const API_SOURCE = readFileSync(new URL('../api/_specialTermClauses.js', import.meta.url), 'utf8');
const SPECIAL_TERMS_SOURCE = readFileSync(new URL('../api/_specialTerms.js', import.meta.url), 'utf8');
const TERM_ID = 'a0X000000000001AAA';
const REVISION_ID = 'a0R000000000001AAA';
const RULE_ID = 'a0S000000000001AAA';
const ACCOUNT_ID = '001000000000001AAA';

function sourceBetween(start, end) {
  const startIndex = API_SOURCE.indexOf(start);
  const endIndex = API_SOURCE.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return API_SOURCE.slice(startIndex, endIndex).replaceAll(/^export /gm, '');
}

function specialTermsSourceBetween(start, end) {
  const startIndex = SPECIAL_TERMS_SOURCE.indexOf(start);
  const endIndex = SPECIAL_TERMS_SOURCE.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return SPECIAL_TERMS_SOURCE.slice(startIndex, endIndex).replaceAll(/^export /gm, '');
}

const apiPrelude = sourceBetween('const OBJECTS =', 'function failureFromComposite');
const graphAssertions = sourceBetween('function failureFromComposite', 'function cleanClauseText');
const requiredReasonSource = sourceBetween('function requiredReason', 'function draftProvenance');
const revisionGraphSource = sourceBetween('function revisionCompositions', 'function apexUtcTimestamp');
const saveSource = sourceBetween('export async function saveSpecialTermRevision', '/** Atomically activates every projection.');
const commitSource = sourceBetween('function childOperationId', 'export async function rollbackSpecialTermRevision');
const mapVersionSource = sourceBetween('function mapVersion', 'function mapClause');
const detailSource = sourceBetween('function assignmentFields', 'async function ensureUniqueClause');
const saveAllMigrationSource = sourceBetween('export async function saveAllSpecialTermMigrationReview', 'export async function activateSpecialTermMigration');
const summaryWorkflowSource = specialTermsSourceBetween('function summaryWorkflow', '/** Lightweight, paginated Special Terms list');

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function specialTermsError(message, status = 400, code = null, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function salesforceId(value, label = 'Salesforce record') {
  const id = text(value, 18);
  if (!/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(id)) throw specialTermsError(`${label} is invalid.`, 400, 'SPECIAL_TERMS_INVALID_ID');
  return id;
}

function soql(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function baseContext(overrides = {}) {
  return {
    assertCurrent(record, expected) {
      if (expected && record?.LastModifiedDate !== expected) throw specialTermsError('The record changed after it was opened.', 409, 'SPECIAL_TERMS_STALE');
    },
    CLAUSE_LIST_STYLES,
    CLAUSE_PROJECTIONS,
    clauseHash,
    console,
    SPECIAL_TERM_PENDING_REASON,
    salesforceId,
    soql,
    specialTermsError,
    text,
    ...overrides,
  };
}

function evaluate(parts, exports, context) {
  const assignments = exports.map((name) => `globalThis.${name} = ${name};`).join('\n');
  vm.runInNewContext(`${parts.join('\n')}\n${assignments}`, context, { filename: 'api/_specialTermClauses.vm.js' });
  return context;
}

function projectionPayload() {
  return [
    { projection: 'termsText', style: 'Numbered', versionIds: [], versionTimestamps: {} },
    { projection: 'confirmationRemark', style: 'Hyphen', versionIds: [], versionTimestamps: {} },
    { projection: 'nominationRemark', style: 'Hyphen', versionIds: [], versionTimestamps: {} },
  ];
}

function schema() {
  return {
    audienceOptions: [{ value: 'Buyer' }, { value: 'Supplier' }],
    countryOptions: [{ value: 'SINGAPORE' }, { value: 'CHINA' }],
  };
}

function graphHarness({ liveRules = [], updatingRevision = null, unfinishedRevisions = [] } = {}) {
  const writes = [];
  const queries = [];
  const finishCalls = [];
  const requiredDescribeFields = {
    Special_Term_Revision__c: ['Special_Term__c', 'Revision_Key__c', 'Revision_Number__c', 'Status__c', 'Revision_Reason__c', 'Proposed_By_Email__c', 'Confirmation_Style__c', 'Nomination_Style__c', 'Prior_Confirmation_Style__c', 'Prior_Nomination_Style__c'],
    Special_Term_Revision_Clause__c: ['Special_Term_Revision__c', 'Clause__c', 'Clause_Version__c', 'Projection__c', 'Sequence__c', 'State__c', 'Revision_Clause_Key__c'],
    Special_Term_Revision_Rule__c: ['Special_Term_Revision__c', 'Special_Term_Rule__c', 'Snapshot_Type__c', 'Sequence__c', 'Audience__c', 'Account__c', 'Port__c', 'Product__c', 'Country__c', 'Priority__c', 'Source_Last_Modified__c', 'State__c', 'Rule_Key__c'],
  };
  const context = baseContext({
    assertCurrent: vm.runInNewContext(`(${specialTermsSourceBetween('export function assertCurrent', 'function apexUtcTimestamp').trim()})`, { specialTermsError }),
    async currentRecord(objectName) {
      if (objectName === 'Special_Term_Revision__c') return updatingRevision;
      assert.equal(objectName, 'Special_Term__c');
      return {
        Id: TERM_ID,
        Approval_Status__c: 'Approved',
        Current_Revision__c: 'a0R000000000000AAA',
        Confirmation_Clause_Style__c: 'Hyphen',
        Nomination_Clause_Style__c: 'Hyphen',
        LastModifiedDate: '2026-09-12T01:00:00.000Z',
      };
    },
    finishOperation(_client, operation, response) {
      finishCalls.push({ operation, response });
      return response;
    },
    getApiVersion: () => 'v65.0',
    async liveApprovedVersions(versionIds) {
      assert.deepEqual(Array.from(versionIds), []);
      return [];
    },
    async sfQuery(query) {
      queries.push(query);
      if (query.includes('FROM Special_Term_Rule__c')) return { records: liveRules, totalSize: liveRules.length };
      if (query.includes("Status__c IN ('Draft','In Review','Ready for Approval','Changes Requested')")) return { records: unfinishedRevisions, totalSize: unfinishedRevisions.length };
      return { records: [], totalSize: 0 };
    },
    async sfRequest(path, options) {
      if (path.includes('/describe/')) {
        const objectName = decodeURIComponent(path.split('/').at(-3));
        return { fields: requiredDescribeFields[objectName].map((name) => ({ name, createable: true })) };
      }
      writes.push({ path, options });
      return {
        graphs: [{ isSuccessful: true, graphResponse: { compositeResponse: [{ referenceId: 'revision', httpStatusCode: 201, body: { id: REVISION_ID, success: true } }] } }],
      };
    },
    async validateRuleLookups() {},
  });
  evaluate([apiPrelude, graphAssertions, revisionGraphSource], ['revisionCompositions', 'saveSpecialTermRevisionGraph'], context);
  return { context, finishCalls, queries, writes };
}

async function runGraph(harness, { submitForReview = false, rules = [], revisionId = 'draft-operation-key' } = {}) {
  const body = {
    termId: TERM_ID,
    expectedLastModifiedAt: '2026-09-12T01:00:00.000Z',
    projections: projectionPayload(),
    rules,
    expectedRevisionLastModifiedAt: '2026-09-12T02:00:00.000Z',
  };
  const compositions = harness.context.revisionCompositions(body, schema());
  return harness.context.saveSpecialTermRevisionGraph(
    {},
    { email: 'editor@example.com' },
    body,
    schema(),
    compositions,
    'Draft reason',
    revisionId,
    { operation: { id: 'reservation' } },
    submitForReview,
  );
}

test('Draft graph is one atomic write and does not alter an Approved live term or invoke Apex', async () => {
  const harness = graphHarness();
  const result = await runGraph(harness);

  assert.equal(result.status, 'Draft');
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].path, '/composite/graph');
  const requests = harness.writes[0].options.body.graphs[0].compositeRequest;
  assert.equal(requests.find((request) => request.referenceId === 'revision').body.Status__c, 'Draft');
  assert.equal(requests.some((request) => request.referenceId === 'revisionReady'), false);
  assert.equal(requests.some((request) => request.referenceId === 'revisionTerm'), false);
  assert.equal(harness.writes.some(({ path }) => path.includes('/apexrest/')), false);
  assert.equal(harness.finishCalls.length, 1);
});

test('submitting the same graph moves the revision to In Review inside the atomic graph', async () => {
  const harness = graphHarness();
  const result = await runGraph(harness, { submitForReview: true });
  const requests = harness.writes[0].options.body.graphs[0].compositeRequest;
  const ready = requests.find((request) => request.referenceId === 'revisionReady');

  assert.equal(result.status, 'In Review');
  assert.deepEqual({ method: ready.method, status: ready.body.Status__c }, { method: 'PATCH', status: 'In Review' });
  assert.equal(harness.writes.length, 1);
});

test('stale and invalid proposed rules fail before the Salesforce graph write', async (t) => {
  const liveRule = {
    Id: RULE_ID,
    Special_Term__c: TERM_ID,
    Supplier_Buyer__c: 'Buyer',
    Account__c: ACCOUNT_ID,
    Port__c: null,
    Product__c: null,
    Country__c: null,
    Priority__c: 1,
    LastModifiedDate: '2026-09-12T02:00:00.000Z',
  };

  await t.test('stale source timestamp', async () => {
    const harness = graphHarness({ liveRules: [liveRule] });
    await assert.rejects(
      runGraph(harness, { rules: [{ sourceRuleId: RULE_ID, lastModifiedAt: '2026-09-12T01:59:00.000Z' }] }),
      (error) => error.code === 'SPECIAL_TERMS_REVISION_RULE_STALE' && error.status === 409,
    );
    assert.equal(harness.writes.length, 0);
  });

  await t.test('new rule without audience', async () => {
    const harness = graphHarness();
    await assert.rejects(runGraph(harness, { rules: [{ accountId: ACCOUNT_ID }] }), /requires Buyer or Supplier/);
    assert.equal(harness.writes.length, 0);
  });

  await t.test('new rule without a condition', async () => {
    const harness = graphHarness();
    await assert.rejects(runGraph(harness, { rules: [{ audience: 'Buyer' }] }), /requires at least one Account, Port, Product, or Country/);
    assert.equal(harness.writes.length, 0);
  });
});

test('a Ready for Approval revision can be reopened, while another Ready revision blocks saving', async (t) => {
  await t.test('the current Ready revision can be saved back to Draft', async () => {
    const harness = graphHarness({
      updatingRevision: {
        Id: REVISION_ID,
        Special_Term__c: TERM_ID,
        Revision_Number__c: 2,
        Revision_Key__c: `${TERM_ID}:2`,
        Status__c: 'Ready for Approval',
        LastModifiedDate: '2026-09-12T02:00:00.000Z',
      },
    });
    const result = await runGraph(harness, { revisionId: REVISION_ID });
    assert.equal(result.status, 'Draft');
    assert.equal(harness.writes.length, 1);
    const requests = harness.writes[0].options.body.graphs[0].compositeRequest;
    const revision = requests.find((request) => request.referenceId === 'revision');
    assert.equal(revision.method, 'PATCH');
    assert.equal(revision.body.Status__c, 'Draft');
    assert.equal(harness.queries.some((query) => query.includes(`AND Id != '${REVISION_ID}'`)), true);
  });

  await t.test('a different Ready revision is treated as unfinished', async () => {
    const harness = graphHarness({ unfinishedRevisions: [{ Id: REVISION_ID, Status__c: 'Ready for Approval' }] });
    await assert.rejects(
      runGraph(harness),
      (error) => error.code === 'SPECIAL_TERMS_REVISION_PENDING' && error.status === 409,
    );
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.queries.some((query) => query.includes("Status__c IN ('Draft','In Review','Ready for Approval','Changes Requested')")), true);
  });
});

function saveHarness() {
  const reservations = [];
  const graphCalls = [];
  const context = baseContext({
    async failOperation(_client, _operation, error) { throw error; },
    async reserveOperation(_client, _profile, _body, operationType, fingerprint) {
      reservations.push({ operationType, fingerprint });
      return { operation: { id: `reservation-${reservations.length}` } };
    },
    async resolveSpecialTermsSchema() { return schema(); },
    async saveSpecialTermRevisionGraph(...args) {
      graphCalls.push(args);
      return { success: true, revisionId: REVISION_ID, status: args.at(-1) ? 'In Review' : 'Draft' };
    },
  });
  evaluate([apiPrelude, requiredReasonSource, revisionGraphSource.slice(0, revisionGraphSource.indexOf('async function revisionSchema')), saveSource], ['saveSpecialTermRevision'], context);
  return { context, graphCalls, reservations };
}

test('Draft save accepts an optional or short reason, while submit requires a substantive reason', async () => {
  const harness = saveHarness();
  const base = { termId: TERM_ID, revisionId: 'draft-operation', projections: projectionPayload(), operationId: 'operation-1' };

  await harness.context.saveSpecialTermRevision({}, { email: 'editor@example.com' }, base, { submitForReview: false });
  await harness.context.saveSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, revisionId: 'draft-operation-2', operationId: 'operation-2', revisionReason: 'x' }, { submitForReview: false });

  assert.equal(harness.graphCalls[0][5], SPECIAL_TERM_PENDING_REASON);
  assert.equal(harness.graphCalls[1][5], 'x');
  await assert.rejects(
    harness.context.saveSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, revisionReason: 'x' }, { submitForReview: true }),
    (error) => error.code === 'SPECIAL_TERMS_REASON_REQUIRED',
  );
});

test('revision save rejects incomplete projections before reserving or writing', async () => {
  const harness = saveHarness();
  await assert.rejects(
    harness.context.saveSpecialTermRevision({}, { email: 'editor@example.com' }, { termId: TERM_ID, revisionId: 'draft-operation', projections: projectionPayload().slice(0, 2) }, { submitForReview: false }),
    (error) => error.code === 'SPECIAL_TERMS_REVISION_INCOMPLETE',
  );
  assert.equal(harness.reservations.length, 0);
  assert.equal(harness.graphCalls.length, 0);
});

test('same-count rule edits produce different idempotency fingerprints', async () => {
  const harness = saveHarness();
  const base = { termId: TERM_ID, projections: projectionPayload() };
  await harness.context.saveSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, revisionId: 'draft-a', rules: [{ audience: 'Buyer', accountId: ACCOUNT_ID }] }, { submitForReview: false });
  await harness.context.saveSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, revisionId: 'draft-b', rules: [{ audience: 'Supplier', accountId: ACCOUNT_ID }] }, { submitForReview: false });

  assert.equal(harness.reservations.length, 2);
  assert.notEqual(harness.reservations[0].fingerprint.rulesHash, harness.reservations[1].fingerprint.rulesHash);
});

function commitHarness() {
  const reservations = [];
  const saves = [];
  const apexCalls = [];
  let savedRevisionStatus = 'Draft';
  const context = baseContext({
    async callRevisionApex(...args) {
      apexCalls.push(args);
      return { success: true, revisionId: args[0], status: 'Active' };
    },
    async currentRecord(objectName, id) {
      assert.equal(objectName, 'Special_Term_Revision__c');
      return { Id: id, Special_Term__c: TERM_ID, Status__c: savedRevisionStatus, LastModifiedDate: '2026-09-12T03:00:00.000Z' };
    },
    async failOperation(_client, _operation, error) { throw error; },
    async finishOperation(_client, _operation, response) { return response; },
    async getSpecialTermDetail() { return { revision: { id: REVISION_ID, status: savedRevisionStatus } }; },
    hasMaterialDifference: () => false,
    async reserveOperation(_client, _profile, _body, operationType, fingerprint) {
      reservations.push({ operationType, fingerprint });
      return { operation: { id: `reservation-${reservations.length}` } };
    },
    async saveSpecialTermRevision(_client, _profile, body, options) {
      saves.push({ body, options });
      savedRevisionStatus = options.submitForReview ? 'In Review' : 'Draft';
      return { success: true, revisionId: REVISION_ID, status: savedRevisionStatus };
    },
    async sfQuery() { return { records: [], totalSize: 0 }; },
  });
  evaluate([apiPrelude, requiredReasonSource, commitSource], ['commitSpecialTermRevision'], context);
  return { apexCalls, context, reservations, saves };
}

test('Save Draft, submit, and approval preserve the permission boundary and Apex publication boundary', async () => {
  const harness = commitHarness();
  const base = {
    termId: TERM_ID,
    revisionId: REVISION_ID,
    projections: projectionPayload(),
    operationId: 'workflow-operation',
    revisionReason: 'Reviewed contractual wording',
  };

  const draft = await harness.context.commitSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, mode: 'save_draft', revisionReason: '' });
  assert.equal(draft.status, 'Draft');
  assert.equal(harness.saves[0].options.submitForReview, false);
  assert.equal(harness.apexCalls.length, 0);

  const submitted = await harness.context.commitSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, mode: 'submit', operationId: 'workflow-submit' });
  assert.equal(submitted.status, 'In Review');
  assert.equal(harness.saves[1].options.submitForReview, true);
  assert.equal(harness.apexCalls.length, 0);

  await assert.rejects(
    harness.context.commitSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, mode: 'approve_publish', operationId: 'workflow-denied' }, { canApprove: false }),
    (error) => error.code === 'SPECIAL_TERMS_CLAUSE_APPROVER_REQUIRED' && error.status === 403,
  );
  assert.equal(harness.apexCalls.length, 0);

  const approved = await harness.context.commitSpecialTermRevision({}, { email: 'gm@example.com' }, { ...base, mode: 'approve_publish', operationId: 'workflow-approved' }, { canApprove: true });
  assert.equal(approved.status, 'Active');
  assert.equal(harness.apexCalls.length, 1);
  assert.equal(harness.apexCalls[0][2], 'approve-publish');
  assert.equal(harness.apexCalls[0][5], 'gm@example.com');
});

test('commit requires complete editor contents for Save Draft and fingerprints rule content', async () => {
  const harness = commitHarness();
  await assert.rejects(
    harness.context.commitSpecialTermRevision({}, { email: 'editor@example.com' }, { termId: TERM_ID, revisionId: REVISION_ID, mode: 'save_draft' }),
    (error) => error.code === 'SPECIAL_TERMS_REVISION_PROJECTIONS_REQUIRED',
  );
  assert.equal(harness.reservations.length, 0);

  const base = { termId: TERM_ID, revisionId: REVISION_ID, mode: 'save_draft', projections: projectionPayload() };
  await harness.context.commitSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, operationId: 'rules-a', rules: [{ audience: 'Buyer', accountId: ACCOUNT_ID }] });
  await harness.context.commitSpecialTermRevision({}, { email: 'editor@example.com' }, { ...base, operationId: 'rules-b', rules: [{ audience: 'Supplier', accountId: ACCOUNT_ID }] });
  assert.notEqual(harness.reservations[0].fingerprint.rulesHash, harness.reservations[1].fingerprint.rulesHash);
});

test('detail loading selects the latest Draft and returns the proposed source-rule timestamp', async () => {
  const seenQueries = [];
  const context = baseContext({
    consolidationSelect: () => '',
    getInstanceUrl: () => 'https://example.my.salesforce.com',
    async resolveSpecialTermsSchema() {},
    async sfQuery(query) {
      seenQueries.push(query);
      if (query.includes('FROM Special_Term__c WHERE')) return { records: [{
        Id: TERM_ID,
        Name: 'Approved term',
        Approval_Status__c: 'Approved',
        Clause_Structure_Status__c: 'Active',
        Confirmation_Clause_Status__c: 'Active',
        Nomination_Clause_Status__c: 'Active',
        Confirmation_Clause_Style__c: 'Hyphen',
        Nomination_Clause_Style__c: 'Hyphen',
        LastModifiedDate: '2026-09-12T00:00:00.000Z',
      }], totalSize: 1 };
      if (query.includes('FROM Special_Term_Clause_Assignment__c')) return { records: [], totalSize: 0 };
      if (query.includes('FROM Special_Term_Rule__c')) return { records: [], totalSize: 0 };
      if (query.includes("Status__c IN ('Draft','In Review','Ready for Approval','Changes Requested')")) return { records: [{ Id: REVISION_ID, Status__c: 'Draft', Revision_Reason__c: SPECIAL_TERM_PENDING_REASON, Revision_Number__c: 2, LastModifiedDate: '2026-09-12T02:00:00.000Z' }], totalSize: 1 };
      if (query.includes('FROM Special_Term_Revision_Clause__c')) return { records: [], totalSize: 0 };
      if (query.includes('FROM Special_Term_Revision_Rule__c')) return { records: [{
        Id: 'a0T000000000001AAA',
        Special_Term_Rule__c: RULE_ID,
        Snapshot_Type__c: 'Proposed',
        Sequence__c: 1,
        Audience__c: 'Buyer',
        Account__c: ACCOUNT_ID,
        Source_Last_Modified__c: '2026-09-12T01:30:00.000Z',
        State__c: 'Proposed',
        LastModifiedDate: '2026-09-12T02:00:00.000Z',
      }], totalSize: 1 };
      if (query.includes('FROM Special_Term_Revision__c')) return { records: [], totalSize: 0 };
      throw new Error(`Unexpected SOQL: ${query}`);
    },
  });
  evaluate([apiPrelude, mapVersionSource, detailSource], ['getSpecialTermDetail'], context);

  const detail = await context.getSpecialTermDetail(TERM_ID);
  assert.equal(detail.revision.status, 'Draft');
  assert.equal(detail.revision.rules[0].sourceRuleId, RULE_ID);
  assert.equal(detail.revision.rules[0].sourceLastModifiedAt, '2026-09-12T01:30:00.000Z');
  assert.equal(seenQueries.some((query) => query.includes("Status__c IN ('Draft','In Review','Ready for Approval','Changes Requested')")), true);
});

test('summary workflow distinguishes editable drafts from revisions ready for approval', () => {
  const context = {};
  evaluate([summaryWorkflowSource], ['summaryWorkflow'], context);
  const activeTerm = {
    relinkRequiredCount: 0,
    revisionStatus: '',
    clauseStructureStatus: 'Active',
    confirmationClauseStatus: 'Active',
    nominationClauseStatus: 'Active',
  };

  assert.deepEqual(
    { ...context.summaryWorkflow(activeTerm, { Status__c: 'Draft' }) },
    { status: 'Draft', nextAction: 'continue' },
  );
  assert.deepEqual(
    { ...context.summaryWorkflow(activeTerm, { Status__c: 'Changes Requested' }) },
    { status: 'Draft', nextAction: 'continue' },
  );
  for (const status of ['In Review', 'Ready for Approval']) {
    assert.deepEqual(
      { ...context.summaryWorkflow(activeTerm, { Status__c: status }) },
      { status: 'Ready for approval', nextAction: 'review_publish' },
    );
  }
  assert.deepEqual(
    { ...context.summaryWorkflow({ ...activeTerm, relinkRequiredCount: 1 }, { Status__c: 'In Review' }) },
    { status: 'Relink required', nextAction: 'resolve_relink' },
  );
});

function migrationHarness({
  existingAssignments = [],
  termStatus = { termsText: 'Active', confirmationRemark: 'In Review', nominationRemark: 'Legacy' },
} = {}) {
  const writes = [];
  const planned = [];
  const term = {
    Id: TERM_ID,
    Name: 'Mixed lifecycle term',
    Approval_Status__c: 'Approved',
    Terms_Text__c: '1. Approved wording.',
    Original_Terms_Text__c: 'Original approved wording.',
    Clause_Structure_Status__c: termStatus.termsText,
    Clause_Migration_Batch_Id__c: 'active-batch',
    Special_Remark_in_Confirmation__c: '- Prepared confirmation.',
    Original_Confirmation_Remark__c: 'Original confirmation.',
    Confirmation_Clause_Status__c: termStatus.confirmationRemark,
    Confirmation_Migration_Batch_Id__c: 'prepared-batch',
    Confirmation_Clause_Style__c: 'Hyphen',
    Special_Remark_in_Nomination__c: '- Legacy nomination.',
    Original_Nomination_Remark__c: null,
    Nomination_Clause_Status__c: termStatus.nominationRemark,
    Nomination_Migration_Batch_Id__c: null,
    Nomination_Clause_Style__c: 'Hyphen',
    LastModifiedDate: '2026-09-12T04:00:00.000Z',
  };
  const context = baseContext({
    canonicalClauseKey: (value) => clauseHash(value),
    async currentRecord() { return term; },
    async expireSpecialTermClauseCaches() {},
    async failOperation(_client, _operation, error) { throw error; },
    async finishOperation(_client, _operation, response) { return response; },
    getApiVersion: () => 'v65.0',
    async getSpecialTermDetail() { return { id: TERM_ID }; },
    async loadClauseRows() { return { clauses: [] }; },
    normalizeMigrationSegments: (segments) => segments,
    async planMigrationCandidates(_profile, segments, options) {
      planned.push({ segments, options });
      return segments.map((_segment, index) => ({
        index,
        isNew: false,
        clauseId: 'a0C000000000001AAA',
        versionId: 'a0V000000000001AAA',
        canonicalKey: `legacy-${index}`,
      }));
    },
    async reserveOperation() { return { operation: { id: 'migration-reservation' } }; },
    async resolveSpecialTermsSchema() { return schema(); },
    async sfQuery() { return { records: existingAssignments, totalSize: existingAssignments.length }; },
    async sfRequest(path, options) {
      writes.push({ path, options });
      return { graphs: [{ isSuccessful: true, graphResponse: { compositeResponse: [] } }] };
    },
    shortNameKey: (value) => text(value).toLowerCase(),
  });
  evaluate([apiPrelude, graphAssertions, requiredReasonSource, saveAllMigrationSource], ['saveAllSpecialTermMigrationReview'], context);
  return { context, planned, term, writes };
}

function migrationProjectionPayload(overrides = {}) {
  return [
    { projection: 'termsText', style: 'Numbered', preservePrepared: true, segments: [], ...overrides.termsText },
    { projection: 'confirmationRemark', style: 'Hyphen', preservePrepared: true, segments: [], ...overrides.confirmationRemark },
    { projection: 'nominationRemark', style: 'Hyphen', preservePrepared: false, segments: [{ clauseText: 'Legacy nomination.' }], ...overrides.nominationRemark },
  ];
}

test('all-projection migration preserves Active and prepared projections while preparing only Legacy', async () => {
  const activeAssignment = { Id: 'a0A000000000001AAA', Projection__c: 'Terms Text' };
  const preparedAssignment = { Id: 'a0A000000000002AAA', Projection__c: 'Confirmation Remark' };
  const oldLegacyAssignment = { Id: 'a0A000000000003AAA', Projection__c: 'Nomination Remark' };
  const harness = migrationHarness({ existingAssignments: [activeAssignment, preparedAssignment, oldLegacyAssignment] });
  const result = await harness.context.saveAllSpecialTermMigrationReview({}, { email: 'editor@example.com' }, {
    termId: TERM_ID,
    expectedLastModifiedAt: harness.term.LastModifiedDate,
    operationId: 'mixed-migration',
    auditReason: 'Prepare remaining legacy projection',
    projections: migrationProjectionPayload(),
  });

  assert.deepEqual(Array.from(result.projections, ({ projection }) => projection), ['nominationRemark']);
  assert.equal(harness.planned.length, 1);
  assert.equal(harness.planned[0].options.referencePrefix, 'migration2');
  assert.equal(harness.writes.length, 1);
  const requests = harness.writes[0].options.body.graphs[0].compositeRequest;
  const archivedIds = requests.filter(({ referenceId }) => referenceId.startsWith('archivePriorProposal')).map(({ url }) => url.split('/').at(-1));
  assert.deepEqual(archivedIds, [oldLegacyAssignment.Id]);
  assert.equal(requests.some(({ url }) => url.endsWith(`/${activeAssignment.Id}`) || url.endsWith(`/${preparedAssignment.Id}`)), false);
  const assignments = requests.filter(({ url, method }) => method === 'POST' && url.endsWith('/Special_Term_Clause_Assignment__c'));
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].body.Projection__c, 'Nomination Remark');
  const termPatch = requests.find(({ referenceId }) => referenceId === 'migrationTerm').body;
  assert.deepEqual(Object.keys(termPatch).sort(), [
    'Nomination_Clause_Status__c',
    'Nomination_Clause_Style__c',
    'Nomination_Migration_Batch_Id__c',
    'Original_Nomination_Remark__c',
  ].sort());
  assert.equal(termPatch.Nomination_Clause_Status__c, 'In Review');
});

test('preserved migration projections fail closed when stale or combined with replacement segments', async (t) => {
  await t.test('prepared non-Active projection has no proposed rows', async () => {
    const harness = migrationHarness({ existingAssignments: [{ Id: 'a0A000000000003AAA', Projection__c: 'Nomination Remark' }] });
    await assert.rejects(
      harness.context.saveAllSpecialTermMigrationReview({}, { email: 'editor@example.com' }, {
        termId: TERM_ID,
        operationId: 'stale-preserve',
        auditReason: 'Prepare remaining legacy projection',
        projections: migrationProjectionPayload(),
      }),
      (error) => error.code === 'SPECIAL_TERMS_STALE' && error.status === 409,
    );
    assert.equal(harness.writes.length, 0);
  });

  await t.test('preserved projection also supplies replacement segments', async () => {
    const harness = migrationHarness();
    await assert.rejects(
      harness.context.saveAllSpecialTermMigrationReview({}, { email: 'editor@example.com' }, {
        termId: TERM_ID,
        operationId: 'invalid-preserve-segments',
        auditReason: 'Prepare remaining legacy projection',
        projections: migrationProjectionPayload({ termsText: { segments: [{ clauseText: 'Replacement wording.' }] } }),
      }),
      /preserved projection cannot also supply replacement legacy clauses/,
    );
    assert.equal(harness.writes.length, 0);
  });
});

test('Active migration projection requires preservePrepared', async () => {
  const harness = migrationHarness();
  await assert.rejects(
    harness.context.saveAllSpecialTermMigrationReview({}, { email: 'editor@example.com' }, {
      termId: TERM_ID,
      operationId: 'active-without-preserve',
      auditReason: 'Prepare remaining legacy projection',
      projections: migrationProjectionPayload({ termsText: { preservePrepared: false } }),
    }),
    (error) => error.code === 'SPECIAL_TERMS_ALREADY_STRUCTURED' && error.status === 409,
  );
  assert.equal(harness.writes.length, 0);
});


test('save accepts equivalent Salesforce timezone formats and rejects actual source changes', async () => {
  const liveRule = { Id: RULE_ID, Special_Term__c: TERM_ID, Country__c: 'CHINA', LastModifiedDate: '2026-09-12T02:00:00.000+0000' };
  for (const expected of ['2026-09-12T02:00:00.000Z', '2026-09-12T10:00:00.000+08:00']) {
    const harness = graphHarness({ liveRules: [liveRule] });
    await runGraph(harness, { rules: [{ sourceRuleId: RULE_ID, lastModifiedAt: expected }] });
    assert.equal(harness.writes.length, 1);
  }
  for (const expected of ['2026-09-12T02:00:00.001Z', 'invalid timestamp']) {
    const harness = graphHarness({ liveRules: [liveRule] });
    await assert.rejects(runGraph(harness, { rules: [{ sourceRuleId: RULE_ID, lastModifiedAt: expected }] }), error => error.code === 'SPECIAL_TERMS_REVISION_RULE_STALE');
    assert.equal(harness.writes.length, 0);
  }
});

test('published China can start and save another revision using its current audience-less country rule', async () => {
  const liveRule = { Id: RULE_ID, Special_Term__c: TERM_ID, Supplier_Buyer__c: null, Account__c: null, Country__c: 'CHINA', LastModifiedDate: '2026-09-12T21:32:40.000+0000' };
  const activeRevision = { id: 'a0R000000000000AAA', status: 'Active', rules: [{ id: 'a0T000000000001AAA', sourceRuleId: null, sourceLastModifiedAt: '2020-08-26T17:09:45.000+0000', audience: '', country: 'CHINA' }] };
  const draft = localRevisionFromDetail({ rules: [{ id: RULE_ID, audience: '', country: 'CHINA', lastModifiedAt: liveRule.LastModifiedDate }] }, activeRevision);
  const harness = graphHarness({ liveRules: [liveRule] });
  await runGraph(harness, { rules: revisionPayload(draft).rules });
  const requests = harness.writes[0].options.body.graphs[0].compositeRequest;
  const saved = requests.find(r => r.referenceId === 'revisionRuleProposed0').body;
  assert.equal(saved.Special_Term_Rule__c, RULE_ID);
  assert.equal(saved.Source_Last_Modified__c, liveRule.LastModifiedDate);
  assert.equal(saved.Audience__c, null);
  assert.equal(saved.Country__c, 'CHINA');
});

test('new geographic/product revision rules save without a role but still require a condition', async () => {
  for (const condition of [{ country: 'CHINA' }, { portId: 'a09000000000001AAA' }, { productId: '01t000000000001AAA' }]) {
    const harness = graphHarness();
    await runGraph(harness, { rules: [{ sourceRuleId: null, audience: '', ...condition }] });
    const saved = harness.writes[0].options.body.graphs[0].compositeRequest.find(r => r.referenceId === 'revisionRuleProposed0').body;
    assert.equal(saved.Audience__c, null);
  }
});

test('direct rule validation permits general rules and requires a role for accounts', () => {
  const context = evaluate([specialTermsSourceBetween('export function rulePayload', 'export async function validateRuleLookups')], ['rulePayload'], baseContext());
  assert.equal(context.rulePayload({ specialTermId: TERM_ID, country: 'CHINA' }, schema()).Supplier_Buyer__c, null);
  assert.throws(() => context.rulePayload({ specialTermId: TERM_ID, accountId: ACCOUNT_ID }, schema()), /requires Buyer or Supplier/);
  assert.equal(context.rulePayload({ specialTermId: TERM_ID, accountId: ACCOUNT_ID, audience: 'Buyer' }, schema()).Supplier_Buyer__c, 'Buyer');
  assert.throws(() => context.rulePayload({ specialTermId: TERM_ID, country: 'CHINA', audience: 'Unknown' }, schema()), /Select Buyer or Supplier/);
});
