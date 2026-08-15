import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Special Terms is term-first with two lightweight workspaces and a dedicated editor', () => {
  const page = read('src/pages/SpecialTerms.jsx');
  const editor = read('src/pages/SpecialTermEditor.jsx');
  const app = read('src/App.jsx');
  assert.match(page, /specialTermsSummaryList/);
  assert.doesNotMatch(page, /specialTermsWorkspace/);
  assert.match(page, /views=\{\[\{ id: 'terms', label: 'Special Terms'[\s\S]*\{ id: 'clauses', label: 'Clause Library'/);
  assert.match(app, /path="\/special-terms\/:termId"/);
  assert.match(editor, /prefetchSpecialTermDetail/);
  assert.match(editor, /mergeCommittedDetail/);
  assert.doesNotMatch(editor.match(/const mergeCommittedDetail = [\s\S]*?\n  };/)?.[0] || '', /load\(/);
});

test('summary queries omit contractual projections and complete rule records', () => {
  const service = read('api/_specialTerms.js');
  const summary = service.match(/export async function listSpecialTermSummaries[\s\S]*?\n}\n\nexport async function getSpecialTermForExport/)?.[0] || '';
  assert.match(summary, /salesforce-special-terms-summary/);
  assert.match(summary, /COUNT\(Id\) ruleCount/);
  assert.doesNotMatch(summary, /Terms_Text__c|Special_Remark_in_Confirmation__c|Special_Remark_in_Nomination__c|Clause_Text__c/);
  assert.match(summary, /nextCursor/);
});

test('one complete editor action submits or atomically approves and publishes', () => {
  const panel = read('src/components/special-terms/WholeTermRevisionPanel.jsx');
  const service = read('api/_specialTermClauses.js');
  const apex = read('force-app/main/default/classes/SpecialTermRevisionService.cls');
  assert.match(panel, /\['termsText', 'Terms Text'\]/);
  assert.match(panel, /\['confirmationRemark', 'Confirmation'\]/);
  assert.match(panel, /\['nominationRemark', 'Nomination'\]/);
  assert.match(panel, /\['rules', 'Matching Rules'\]/);
  assert.match(panel, /\['preview', 'Preview'\]/);
  assert.match(panel, /canApprove \? 'approve_publish' : 'submit'/);
  assert.match(panel, /specialTermMigrationSaveAll/);
  assert.doesNotMatch(panel.match(/const commit = async[\s\S]*?\n  };/)?.[0] || '', /specialTermMigrationSave['"]|specialTermDetail/);
  assert.match(panel, /Approve &amp; publish/);
  assert.doesNotMatch(panel.match(/const commit = async[\s\S]*?\n  };/)?.[0] || '', /setConfirm/);
  assert.match(service, /'approve-publish'/);
  assert.match(apex, /approveDraftClausesAndActivate/);
  assert.match(apex, /A Draft clause changed after the editor opened/);
  assert.match(apex, /material qualifier/);
});

test('Clause Library hydrates only the visible page and computes near matches on demand', () => {
  const service = read('api/_specialTermClauses.js');
  const handler = read('api/functions/[name].js');
  const panel = read('src/components/special-terms/ClauseBankPanel.jsx');
  const list = service.match(/export async function listSpecialTermClauseBank[\s\S]*?export async function listSpecialTermClauseSimilar/)?.[0] || '';
  assert.match(list, /loadClauseListIndex/);
  assert.match(list, /loadClausePage/);
  assert.match(list, /nextCursor/);
  assert.match(list, /previousCursor/);
  assert.doesNotMatch(list, /loadClauseRows/);
  assert.match(service, /export async function listSpecialTermClauseSimilar/);
  assert.match(handler, /specialTermClauseSimilar/);
  assert.match(panel, /Compare similar wording/);
  assert.doesNotMatch(panel.match(/const loadSimilarClauses = async[\s\S]*?\n  };/)?.[0] || '', /load\(/);
});

test('legacy preparation is one complete all-or-none operation with a fail-closed handler', () => {
  const service = read('api/_specialTermClauses.js');
  const handler = read('api/functions/[name].js');
  const policy = read('api/_handlerPolicyRegistry.js');
  const saveAll = service.match(/export async function saveAllSpecialTermMigrationReview[\s\S]*?\n}\n\nexport async function activateSpecialTermMigration/)?.[0] || '';
  assert.match(saveAll, /requested\.length !== PROJECTION_LIST\.length/);
  assert.match(saveAll, /graphId: 'specialTermCompleteLegacyPreparation'/);
  assert.match(saveAll, /requests\.length > 500/);
  assert.match(saveAll, /getSpecialTermDetail\(termId, \{ force: true \}\)/);
  assert.match(handler, /async function specialTermMigrationSaveAll/);
  assert.match(policy, /specialTermMigrationSaveAll: mutationPolicy/);
});

test('term-first operations remain service-only and redacted', () => {
  const migration = read('supabase/migrations/20260815222413_special_terms_term_first_operations.sql');
  assert.match(migration, /revision_submit/);
  assert.match(migration, /revision_approve_publish/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.special_terms_operations from anon, authenticated/);
  assert.match(migration, /grant all on table public\.special_terms_operations to service_role/);
  assert.doesNotMatch(migration, /Terms_Text__c|Clause_Text__c|revision_reason|audit_reason\s*=/i);
});
