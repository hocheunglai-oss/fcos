import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clauseAction,
  clauseDraftQuality,
  clauseMatchesView,
  exportReadiness,
  loadClauseBankPreferences,
  saveClauseBankPreferences,
  specialTermReadiness,
} from '../src/lib/specialTermsWorkflow.js';

test('clause work queue derives one actionable next state without merging lifecycle views', () => {
  assert.equal(clauseAction({ status: 'Draft', usageCount: 2, draftVersion: {} }), 'blocked_assignment');
  assert.equal(clauseAction({ status: 'Draft', usageCount: 0, origin: 'Legacy', draftVersion: { draftSource: 'Legacy Migration' } }), 'needs_review');
  assert.equal(clauseAction({ status: 'Active', draftVersion: { draftSource: 'Manual' } }), 'ready_approval');
  assert.equal(clauseAction({ status: 'Active', consolidation: { status: 'Relinking' } }), 'relink_required');
  assert.equal(clauseAction({ status: 'Active', consolidation: { status: 'Ready to Retire' } }), 'ready_retire');
  assert.equal(clauseAction({ status: 'Active', origin: 'Legacy' }), null, 'approved Legacy-origin clauses do not remain in the review queue without a Draft');
  assert.equal(clauseMatchesView({ status: 'Active', draftVersion: {} }, 'work', 'ready_approval'), true);
  assert.equal(clauseMatchesView({ status: 'Active' }, 'Active', 'all'), true);
});

test('draft quality blocks structural errors and preserves human review warnings', () => {
  const invalid = clauseDraftQuality({ shortName: 'Too short', clauseText: '1. Payment will be made promptly.', revisionReason: '' });
  assert.ok(invalid.some((issue) => issue.id === 'short-name' && issue.severity === 'error'));
  assert.ok(invalid.some((issue) => issue.id === 'marker' && issue.severity === 'error'));
  assert.ok(invalid.some((issue) => issue.id === 'ambiguity' && issue.severity === 'warning'));
  const ready = clauseDraftQuality({ shortName: 'Invoice Due Without BDR', clauseText: 'The Buyer shall pay the invoice on its due date without requiring a bunker delivery receipt.', revisionReason: 'Standardize payment wording.' });
  assert.deepEqual(ready, [{ id: 'ready', severity: 'success', label: 'Draft passes the automated structure and style checks.' }]);
  assert.ok(!clauseDraftQuality({ shortName: 'Supplier Document Requirements', clauseText: 'The Supplier shall provide:\n- the invoice; and\n- the delivery receipt.', revisionReason: 'Preserve internal bullets.' }).some((issue) => issue.id === 'marker'), 'internal bullets remain permitted');
});

test('whole-term readiness prioritizes relinks, approval, drafts, migration, and approved state', () => {
  const active = { revisionStatus: 'Approved', clauseStructureStatus: 'Active', confirmationClauseStatus: 'Active', nominationClauseStatus: 'Active' };
  assert.equal(specialTermReadiness(active).state, 'ready');
  assert.equal(specialTermReadiness({ ...active, revisionStatus: 'In Review' }).state, 'approval');
  assert.equal(specialTermReadiness({ ...active, relinkRequiredCount: 1 }).state, 'relink');
  assert.equal(specialTermReadiness({ ...active, revisionStatus: 'Draft' }).state, 'draft');
  assert.equal(specialTermReadiness({ clauseStructureStatus: 'Legacy', confirmationClauseStatus: 'Legacy', nominationClauseStatus: 'Legacy' }).state, 'legacy');
  assert.equal(exportReadiness(active).state, 'verified');
  assert.equal(exportReadiness({ clauseStructureStatus: 'Legacy' }).state, 'legacy');
});

test('clause filters persist locally with defensive schema defaults', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  saveClauseBankPreferences({ view: 'Active', action: 'all', category: 'Delivery', origin: 'Manual', usage: 'used', mine: true, duplicatesOnly: true }, storage);
  assert.deepEqual(loadClauseBankPreferences(storage), { view: 'Active', action: 'all', category: 'Delivery', origin: 'Manual', usage: 'used', mine: true, duplicatesOnly: true });
  memory.set('fcos-special-terms-clause-bank-v2', '{broken');
  assert.equal(loadClauseBankPreferences(storage).view, 'work');
});
