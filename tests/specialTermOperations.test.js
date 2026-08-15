import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurrent, reserveOperation, specialTermDeletionInternals } from '../api/_specialTerms.js';
import { specialTermClauseServiceInternals } from '../api/_specialTermClauses.js';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function operationClient() {
  const rows = new Map();
  return {
    rows,
    from() {
      let action = 'select';
      let payload = null;
      let operationId = null;
      return {
        select() { return this; },
        eq(field, value) { if (field === 'operation_id') operationId = value; return this; },
        insert(row) { action = 'insert'; payload = row; return this; },
        update(row) { action = 'update'; payload = row; return this; },
        async maybeSingle() { return { data: rows.get(operationId) || null, error: null }; },
        async single() {
          if (action === 'insert') {
            const row = { id: `row-${rows.size + 1}`, ...payload };
            rows.set(row.operation_id, row);
            return { data: row, error: null };
          }
          if (action === 'update') {
            const row = { ...(rows.get(operationId) || {}), ...payload };
            rows.set(operationId, row);
            return { data: row, error: null };
          }
          return { data: rows.get(operationId) || null, error: null };
        },
      };
    },
  };
}

test('stale Salesforce timestamps fail closed', () => {
  assert.doesNotThrow(() => assertCurrent({ LastModifiedDate: '2026-08-10T00:00:00.000Z' }, '2026-08-10T00:00:00.000Z'));
  assert.throws(() => assertCurrent({ LastModifiedDate: '2026-08-10T00:00:01.000Z' }, '2026-08-10T00:00:00.000Z'), /changed after it was opened/i);
  assert.throws(() => assertCurrent({ LastModifiedDate: '2026-08-10T00:00:00.000Z' }, null), /Refresh before saving/i);
});

test('safe deletion authorization normalizes creator email and preserves protected history', () => {
  assert.equal(specialTermDeletionInternals.normalizedEmail('  Creator@Example.COM '), 'creator@example.com');
  assert.equal(specialTermDeletionInternals.deletionAuthorization({ isCreator: true }), true);
  assert.equal(specialTermDeletionInternals.deletionAuthorization({ isApprover: true }), true);
  assert.equal(specialTermDeletionInternals.deletionAuthorization({}), false);
  for (const status of ['Approved', 'Active', 'Superseded', 'Rejected', 'Rolled Back']) {
    assert.equal(specialTermDeletionInternals.PROTECTED_TERM_REVISION_STATUSES.has(status), true);
  }
  assert.equal(specialTermDeletionInternals.PROTECTED_TERM_REVISION_STATUSES.has('Draft'), false);
  assert.equal(specialTermDeletionInternals.PROTECTED_TERM_REVISION_STATUSES.has('In Review'), false);
});

test('operation reservations replay only an identical successful request', async () => {
  const client = operationClient();
  const profile = { id: '00000000-0000-4000-8000-000000000001', email: 'manager@example.com' };
  const body = { operationId: '00000000-0000-4000-8000-000000000002', revisionReason: 'Create a reviewed clause' };
  const payload = { id: null, contentHash: 'abc123', revisionReasonHash: 'def456' };
  const first = await reserveOperation(client, profile, body, 'clause_draft_create', payload);
  assert.equal(first.operation.operation_status, 'pending');
  client.rows.set(body.operationId, { ...first.operation, operation_status: 'succeeded', result_snapshot: { clauseId: 'a01xx0000000001AAA' } });
  const replay = await reserveOperation(client, profile, body, 'clause_draft_create', payload);
  assert.deepEqual(replay.replay, { clauseId: 'a01xx0000000001AAA' });
  await assert.rejects(() => reserveOperation(client, profile, body, 'clause_draft_create', { ...payload, contentHash: 'different' }), /different data/i);
});

test('short names and composite graph failures are validated centrally', () => {
  assert.equal(specialTermClauseServiceInternals.cleanShortName('Claim Time Bar Seven Days'), 'Claim Time Bar Seven Days');
  assert.throws(() => specialTermClauseServiceInternals.cleanShortName('Two Words'), /3 to 7/);
  assert.throws(() => specialTermClauseServiceInternals.cleanShortName('One Two Three Four Five Six Seven Eight'), /3 to 7/);
  assert.throws(() => specialTermClauseServiceInternals.assertCompositeGraph({ graphs: [{ isSuccessful: false, graphResponse: { compositeResponse: [{ httpStatusCode: 400, body: [{ message: 'Rejected atomically' }] }] } }] }, 'Fallback'), /Rejected atomically/);
  assert.equal(specialTermClauseServiceInternals.failureFromComposite({ compositeResponse: [{ httpStatusCode: 200, body: [{ id: null, success: false, errors: [{ message: 'Nested row rejected' }] }] }] })?.body?.[0]?.message, 'Nested row rejected');
});

test('whole-term revision API uses durable Salesforce revisions and never partially activates projections', () => {
  const service = read('api/_specialTermClauses.js');
  assert.match(service, /Special_Term_Revision__c/);
  assert.match(service, /Special_Term_Revision_Clause__c/);
  assert.match(service, /Special_Term_Revision_Rule__c/);
  assert.match(service, /Snapshot_Type__c: 'Baseline'/);
  assert.match(service, /Snapshot_Type__c: 'Proposed'/);
  const apexService = read('force-app/main/default/classes/SpecialTermRevisionService.cls');
  assert.match(apexService, /Snapshot_Type__c == 'Proposed'/);
  assert.match(apexService, /SpecialTermRuleRevisionHandler\.allowRevisionUpdate = true/);
  assert.match(service, /specialTermWholeRevision/);
  assert.match(service, /callRevisionApex\(.*'activate'/s);
  assert.match(service, /callRevisionApex\(.*'rollback'/s);
  assert.match(service, /A Special Term revision must include Terms Text, Confirmation remark, and Nomination remark/);
  assert.match(service, /store: false/);
  assert.match(service, /const model = DEFAULT_DASHBOARD_AI_MODEL/);
  assert.match(service, /OPENAI_AUTHENTICATION_FAILED/);
  assert.match(service, /OPENAI_INSUFFICIENT_QUOTA/);
  assert.match(service, /OPENAI_MODEL_UNAVAILABLE/);
  assert.match(service, /OPENAI_REQUEST_INVALID/);
  assert.match(service, /type: 'json_schema'/);
  assert.match(service, /strict: true/);
  assert.match(service, /minItems: inputGroups\.length/);
  assert.match(service, /maxItems: inputGroups\.length/);
  assert.match(service, /enum: inputGroups\.map\(\(group\) => group\.id\)/);
  assert.match(service, /Copy every input id exactly/);
  assert.match(service, /Do not add a top-level number or hyphen/);
  assert.match(service, /signal: AbortSignal\.timeout/);
  assert.match(service, /groups\.length > 20/);
  assert.match(service, /hasMaterialDifference\(sourceById\.get\(draft\.id\), draft\.proposedText\)/);
});

test('operations use service-only atomic RPCs and do not retain reviewer prose', () => {
  const service = read('api/_specialTerms.js');
  const migration = read('supabase/migrations/20260813150034_special_term_revision_operations.sql');
  assert.match(service, /reserve_special_terms_operation/);
  assert.match(service, /complete_special_terms_operation/);
  assert.match(service, /audit_reason: null/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on table public\.special_terms_notification_states from anon, authenticated/);
  assert.match(migration, /revoke all on function public\.reserve_special_terms_operation/);
  assert.match(migration, /special_terms_notification_states/);
});

test('safe deletion is creator-or-approver only, dependency checked, and service-ledger redacted', () => {
  const termService = read('api/_specialTerms.js');
  const clauseService = read('api/_specialTermClauses.js');
  const handlers = read('api/functions/[name].js');
  const migration = read('supabase/migrations/20260814082441_special_term_safe_deletion.sql');
  assert.match(termService, /previewSpecialTermDeletion/);
  assert.match(termService, /PROTECTED_TERM_REVISION_STATUSES/);
  assert.match(termService, /Special_Term_Revision_Rule__c/);
  assert.match(termService, /deletionReasonHash: clauseHash\(reason\)/);
  assert.match(termService, /allOrNone: true/);
  assert.match(clauseService, /previewSpecialTermClauseDeletion/);
  assert.match(clauseService, /deleteSpecialTermClause/);
  assert.match(clauseService, /discardSpecialTermClauseDraft/);
  assert.match(clauseService, /Clause assignment lineage must be retained/);
  assert.match(clauseService, /Clause consolidation lineage must be retained/);
  assert.match(handlers, /specialTermDeletePreview/);
  assert.match(handlers, /isSpecialTermClauseApprover/);
  assert.match(migration, /clause_draft_delete/);
  assert.match(migration, /clause_version_discard/);
  assert.match(migration, /reserve_special_terms_operation_v2/);
  assert.match(migration, /special_terms_record_creator/);
  assert.match(migration, /special_terms_records_created_by/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on table public\.special_terms_operations from anon, authenticated/);
  assert.match(migration, /audit_reason_hash = p_audit_reason_hash/);
  assert.doesNotMatch(migration, /Clause_Text__c|Terms_Text__c/);
});

test('Salesforce blocks deletion of governed Special Term lineage', () => {
  const termTrigger = read('force-app/main/default/triggers/SpecialTermTrigger.trigger');
  const termHandler = read('force-app/main/default/classes/SpecialTermTriggerHandler.cls');
  const revisionHandler = read('force-app/main/default/classes/SpecialTermRevisionHandler.cls');
  const ruleHandler = read('force-app/main/default/classes/SpecialTermRuleRevisionHandler.cls');
  const clauseHandler = read('force-app/main/default/classes/SpecialTermClauseHandler.cls');
  const versionHandler = read('force-app/main/default/classes/SpecialTermVersionHandler.cls');
  assert.match(termTrigger, /before delete/);
  assert.match(termHandler, /validateDelete/);
  assert.match(termHandler, /Status__c NOT IN \('Draft', 'In Review'\)/);
  assert.match(revisionHandler, /Only transient Draft or In Review revisions may be deleted/);
  assert.match(ruleHandler, /Special Term rule revision lineage must be retained/);
  assert.match(clauseHandler, /Referenced clause identities/);
  assert.match(versionHandler, /Referenced clause versions/);
});

test('clause consolidation relinks every projection without changing order', () => {
  const detail = {
    projections: {
      termsText: { style: 'Numbered', activeAssignments: [{ clauseId: 'source', clauseVersionId: 'source-v1' }, { clauseId: 'other', clauseVersionId: 'other-v1' }] },
      confirmationRemark: { style: 'Hyphen', activeAssignments: [{ clauseId: 'source', clauseVersionId: 'source-v2' }] },
      nominationRemark: { style: 'Hyphen', activeAssignments: [] },
    },
  };
  assert.deepEqual(specialTermClauseServiceInternals.relinkProjectionPayload(detail, 'source', 'replacement', 'replacement-v3'), [
    { projection: 'termsText', style: 'Numbered', versionIds: ['replacement-v3', 'other-v1'] },
    { projection: 'confirmationRemark', style: 'Hyphen', versionIds: ['replacement-v3'] },
    { projection: 'nominationRemark', style: 'Hyphen', versionIds: [] },
  ]);
  assert.throws(() => specialTermClauseServiceInternals.relinkProjectionPayload({ ...detail, projections: { ...detail.projections, termsText: { style: 'Numbered', activeAssignments: [{ clauseId: 'source', clauseVersionId: 'source-v1' }, { clauseId: 'replacement', clauseVersionId: 'replacement-v3' }] } } }, 'source', 'replacement', 'replacement-v3'), /individual conflict review/i);
});

test('consolidation is Salesforce-owned and Supabase records identifiers only', () => {
  const service = read('api/_specialTermClauses.js');
  const migration = read('supabase/migrations/20260814040851_special_term_clause_consolidation_operations.sql');
  const apex = read('force-app/main/default/classes/SpecialTermConsolidationHandler.cls');
  assert.match(service, /Special_Term_Clause_Consolidation__c/);
  assert.match(service, /Special_Term_Clause_Consolidation_Map__c/);
  assert.match(service, /hasMaterialDifference\(version\.Clause_Text__c, replacementVersion\.Clause_Text__c\)/);
  assert.match(service, /requestedTerms\.length > 20/);
  assert.match(service, /Every live and pending source-clause reference must be relinked before retirement/);
  assert.match(service, /pendingReferenceResult/);
  assert.match(service, /Special_Term_Revision__r\.Status__c IN \('Draft','In Review'\)/);
  assert.match(migration, /clause_consolidation_start/);
  assert.match(migration, /revoke all on table public\.special_terms_operations from anon, authenticated/);
  assert.doesNotMatch(migration, /Clause_Text__c|Terms_Text__c/);
  assert.match(apex, /Clause consolidation lineage must be retained/);
  assert.match(apex, /Version mapping does not match the consolidation identities/);
  assert.match(apex, /Live and pending Special Term references must be relinked/);
  assert.match(apex, /The pinned replacement must be the current approved version/);
  const clauseGuard = read('force-app/main/default/classes/SpecialTermClauseHandler.cls');
  assert.match(clauseGuard, /cannot be retired while live or pending Special Term references/);
  const versionGuard = read('force-app/main/default/classes/SpecialTermVersionHandler.cls');
  assert.match(versionGuard, /Status__c = 'Paused'/);
});

test('clause bank supports action-first server paging and lightweight governed history', () => {
  const service = read('api/_specialTermClauses.js');
  assert.match(service, /function clauseWorkAction/);
  assert.match(service, /validView = \['work', 'Active', 'Retired'\]/);
  assert.match(service, /matched\.slice\(safeOffset, safeOffset \+ safeLimit\)/);
  assert.match(service, /hasMore: safeOffset \+ safeLimit < matched\.length/);
  assert.match(service, /exactDuplicateCount/);
  assert.match(service, /materialDifference: hasMaterialDifference/);
  assert.match(service, /history: ordered\.map/);
});
