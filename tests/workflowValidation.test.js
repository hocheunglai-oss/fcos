import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionWorkflowIssues,
  specialTermRuleIssues,
  unofficialCompensationClaimIssues,
  unofficialCompensationRecoveryIssues,
} from '../src/lib/workflowValidation.js';

test('payment collection validation reports all missing promise fields together', () => {
  const issues = collectionWorkflowIssues({
    form: { status: 'Promise to Pay', promisedPaymentDate: '', promisedAmount: '' },
  });
  assert.deepEqual(issues.map((issue) => issue.field), ['promisedPaymentDate', 'promisedAmount']);
});

test('payment advice accepts either a reference or an existing document', () => {
  const form = {
    status: 'Payment Advice Received',
    adviceReceivedDate: '2026-08-04',
    adviceAmount: '100',
    adviceVerificationDate: '2026-08-05',
    adviceReference: '',
  };
  assert.equal(collectionWorkflowIssues({ form }).length, 1);
  assert.equal(collectionWorkflowIssues({ form, existingAdviceDocumentIds: ['document-1'] }).length, 0);
});

test('unofficial compensation validates identity, dates, eligibility, and calculated amount', () => {
  assert.deepEqual(
    unofficialCompensationClaimIssues({ accountId: '', amount: '', deadlineDate: '', pic: '' }).map((issue) => issue.field),
    ['accountId', 'amount', 'deadlineDate', 'pic'],
  );
  assert.deepEqual(
    unofficialCompensationRecoveryIssues({ form: { claimId: '', stemId: '', lineItemId: '' }, eligible: false, preview: 0 }).map((issue) => issue.field),
    ['claimId', 'stemId', 'lineItemId', 'accountId', 'recoveryAmount'],
  );
});

test('Special Term rules require a term and at least one Salesforce condition', () => {
  const issues = specialTermRuleIssues({ specialTermId: '', country: '__any__' });
  assert.deepEqual(issues.map((issue) => issue.field), ['specialTermId', 'conditions']);
  assert.equal(specialTermRuleIssues({ specialTermId: 'term-1', country: 'Singapore' }).length, 0);
});
