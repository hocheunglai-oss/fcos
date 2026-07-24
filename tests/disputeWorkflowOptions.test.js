import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DISPUTE_BUYER_CLOSE_REASONS,
  DISPUTE_SUPPLIER_CLOSE_REASONS,
} from '../src/lib/disputeWorkflowOptions.js';

test('supplier dispute closure supports UOC opened without changing buyer reasons', () => {
  assert.equal(DISPUTE_SUPPLIER_CLOSE_REASONS.includes('UOC opened'), true);
  assert.equal(DISPUTE_BUYER_CLOSE_REASONS.includes('UOC opened'), false);
  assert.equal(
    new Set(DISPUTE_SUPPLIER_CLOSE_REASONS.map((reason) => reason.toLowerCase())).size,
    DISPUTE_SUPPLIER_CLOSE_REASONS.length,
  );
});

test('Dispute Workflow UI and server validation share the same close-reason definitions', async () => {
  const [pageSource, apiSource] = await Promise.all([
    readFile(new URL('../src/pages/DisputeWorkflow.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  ]);

  assert.match(pageSource, /DISPUTE_SUPPLIER_CLOSE_REASONS\.map/);
  assert.match(apiSource, /DISPUTE_SUPPLIER_CLOSE_REASONS as DISPUTE_BETA_SUPPLIER_CLOSE_REASONS/);
  assert.match(apiSource, /DISPUTE_BETA_SUPPLIER_CLOSE_REASONS\.includes\(closeReason\)/);
});
