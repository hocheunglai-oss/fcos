import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurrent, reserveOperation } from '../api/_specialTerms.js';
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
