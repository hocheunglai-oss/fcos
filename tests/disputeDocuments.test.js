import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disputeWorkflowAvailableFileName,
  disputeWorkflowEditableFilename,
  disputeWorkflowFileExtension,
  disputeWorkflowSuggestedBaseName,
} from '../api/_disputeDocuments.js';

test('suggests Hong Kong date plus direction with one space', () => {
  const instant = new Date('2026-07-09T16:30:00.000Z');
  assert.equal(disputeWorkflowSuggestedBaseName('from_supplier', instant), '20260710 From Supplier');
  assert.equal(disputeWorkflowSuggestedBaseName('to_buyer', instant), '20260710 To Buyer');
});

test('preserves the source extension separately and sanitizes editable names', () => {
  assert.equal(disputeWorkflowFileExtension('Settlement.PDF'), 'pdf');
  assert.equal(disputeWorkflowEditableFilename('  20260710   From: Supplier?.  ', 'fallback'), '20260710 From Supplier');
});

test('increments duplicate filenames case-insensitively within the supplied scope', () => {
  const existing = [
    '20260710 From Supplier.pdf',
    '20260710 FROM SUPPLIER-1.PDF',
    '20260710 From Supplier-3.pdf',
  ];
  assert.equal(disputeWorkflowAvailableFileName('20260710 From Supplier', 'pdf', existing), '20260710 From Supplier-2.pdf');
});

