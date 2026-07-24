import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DISPUTE_BUYER_CLOSE_REASONS,
  DISPUTE_SUPPLIER_CLOSE_REASONS,
} from '../src/lib/disputeWorkflowOptions.js';

test('supplier and buyer dispute closure support UOC opened', () => {
  assert.equal(DISPUTE_SUPPLIER_CLOSE_REASONS.includes('UOC opened'), true);
  assert.equal(DISPUTE_BUYER_CLOSE_REASONS.includes('UOC opened'), true);
  for (const reasons of [DISPUTE_SUPPLIER_CLOSE_REASONS, DISPUTE_BUYER_CLOSE_REASONS]) {
    assert.equal(
      new Set(reasons.map((reason) => reason.toLowerCase())).size,
      reasons.length,
    );
  }
});

test('Dispute Workflow UI and server validation share the same close-reason definitions', async () => {
  const [pageSource, apiSource] = await Promise.all([
    readFile(new URL('../src/pages/DisputeWorkflow.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  ]);

  assert.match(pageSource, /DISPUTE_SUPPLIER_CLOSE_REASONS\.map/);
  assert.match(pageSource, /DISPUTE_BUYER_CLOSE_REASONS\.map/);
  assert.match(apiSource, /DISPUTE_SUPPLIER_CLOSE_REASONS as DISPUTE_BETA_SUPPLIER_CLOSE_REASONS/);
  assert.match(apiSource, /DISPUTE_BUYER_CLOSE_REASONS as DISPUTE_BETA_BUYER_CLOSE_REASONS/);
  assert.match(apiSource, /DISPUTE_BETA_SUPPLIER_CLOSE_REASONS\.includes\(closeReason\)/);
  assert.match(apiSource, /DISPUTE_BETA_BUYER_CLOSE_REASONS\.includes\(closeReason\)/);
});
