import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hasRecordedFcosClosureWriteback,
  isSalesforceDisputeClosed,
  projectExternalDisputeClosure,
} from '../api/_disputeWorkflowStatus.js';

const CASE_ID = '34339406-4b73-4431-83a5-d1b0c066e924';

test('recognizes current and historical Salesforce closure statuses', () => {
  assert.equal(isSalesforceDisputeClosed('Closed'), true);
  assert.equal(isSalesforceDisputeClosed('Closed with Supplier only'), true);
  assert.equal(isSalesforceDisputeClosed(' closed with buyer only '), true);
  assert.equal(isSalesforceDisputeClosed('Approved - Pending Accounting'), false);
});

test('projects a stale FCOS workflow as externally closed without replacing its internal stage', () => {
  const projection = projectExternalDisputeClosure({
    id: CASE_ID,
    workflowStatus: 'Approved - Pending Accounting',
    currentSalesforceStatus: 'Approved - Pending Accounting',
    approvalStatus: 'Approved',
    salesforceWritebackStatus: 'success',
  }, {
    Dispute_Status__c: 'Closed',
    LastModifiedDate: '2026-07-24T05:10:00.000Z',
  });

  assert.deepEqual(projection, {
    workflowStatus: 'Closed',
    currentSalesforceStatus: 'Closed',
    internalWorkflowStatus: 'Approved - Pending Accounting',
    externalClosure: true,
    legacyReadOnly: true,
    salesforceLastModifiedAt: '2026-07-24T05:10:00.000Z',
  });
});

test('does not misclassify a completed FCOS closure as an external closure', () => {
  const projection = projectExternalDisputeClosure({
    id: CASE_ID,
    workflow_status: 'Closed',
    current_salesforce_status: 'Closed',
    closed_at: '2026-07-24T05:10:00.000Z',
    salesforce_writeback_status: 'success',
    salesforce_writeback_error: null,
  }, {
    Dispute_Status__c: 'Closed',
    LastModifiedDate: '2026-07-24T05:10:00.000Z',
  });

  assert.equal(projection, null);
});

test('keeps a recorded FCOS close writeback retryable after a partial database failure', () => {
  const caseRow = {
    id: CASE_ID,
    workflow_status: 'Settled - Ready to Close',
    current_salesforce_status: 'Closed',
    salesforce_writeback_status: 'success',
  };
  assert.equal(hasRecordedFcosClosureWriteback(caseRow), true);
  assert.equal(projectExternalDisputeClosure(caseRow, {
    Dispute_Status__c: 'Closed',
    LastModifiedDate: '2026-07-24T05:10:00.000Z',
  }), null);
});

test('ignores non-closed Salesforce statuses and cases without workflow storage', () => {
  assert.equal(projectExternalDisputeClosure({
    id: CASE_ID,
    workflowStatus: 'Approved - Pending Accounting',
  }, {
    Dispute_Status__c: 'Accounting In Progress',
  }), null);
  assert.equal(projectExternalDisputeClosure(null, {
    Dispute_Status__c: 'Closed',
  }), null);
});

test('queue projection, read-only controls, and conditional Salesforce writeback stay connected', async () => {
  const [apiSource, salesforceSource, pageSource] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_salesforce.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/DisputeWorkflow.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(apiSource, /projectExternallyClosedDisputeWorkflows\(rows, workflowMap\)/);
  assert.match(apiSource, /'If-Unmodified-Since': ifUnmodifiedSince/);
  assert.match(apiSource, /await patchDisputeWorkflowStatusInSalesforce\(caseRow, 'Pending Approval'\)/);
  assert.match(apiSource, /await patchDisputeWorkflowStatusInSalesforce\(caseRow, workflowStatus\)/);
  assert.match(apiSource, /if \(!hasRecordedFcosClosureWriteback\(caseRow\)\) assertSalesforceDisputeIsOpen\(currentStem\)/);
  assert.match(salesforceSource, /sfRequest\(path, \{ method = 'GET', body, headers = \{\}/);
  assert.match(salesforceSource, /\.\.\.headers/);
  assert.match(pageSource, /const canReview = !legacyReadOnly/);
  assert.match(pageSource, /const canManageDocuments = !legacyReadOnly/);
  assert.match(pageSource, /Closed directly in Salesforce\./);
});
