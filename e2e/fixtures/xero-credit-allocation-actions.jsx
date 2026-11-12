import { createRoot } from 'react-dom/client';
import { appClient } from '@/api/appClient';
import XeroCreditAllocationActions from '@/components/xero/XeroCreditAllocationActions';
import '@/index.css';

const tenantId = '10000000-0000-4000-8000-000000000009';
const actorId = '10000000-0000-4000-8000-000000000010';
const creditId = 'a02000000000001AAA';
const reviewFingerprint = 'a'.repeat(64);
const locked = new URLSearchParams(location.search).has('locked');
const key = 'credit-allocation-fixture';
window.creditAllocationFixture = { calls: [] };
appClient.functions.invoke = async (name, body) => {
  window.creditAllocationFixture.calls.push({ name, body });
  if (body.tenantId !== tenantId) throw new Error('Unexpected tenant');
  if (name === 'xeroCreditAllocationPreview') {
    if (body.creditNumber !== 'CN-0100' || body.sourceObject !== 'Supplier_Invoice__c') throw new Error('Unexpected credit');
    return { data: { tenantId, sourceObject: body.sourceObject, creditId, creditNumber: body.creditNumber, originalNumber: 'INV-0100',
      currency: 'HKD', amount: 780, accountingUsd: 100, residualCredit: 50, allocationDate: '2026-09-10', status: 'eligible',
      reviewFingerprint, writeEnabled: !locked } };
  }
  if (name === 'xeroCreditAllocationApply') {
    if (localStorage.getItem(key) || body.creditId !== creditId || !body.reviewed || body.reviewFingerprint !== reviewFingerprint) throw new Error('Invalid submission');
    localStorage.setItem(key, JSON.stringify({ operationId: body.operationId, reviewFingerprint: body.reviewFingerprint }));
    throw new Error('The response was lost.');
  }
  if (name === 'xeroCreditAllocationRecoveryQueue') {
    const original = JSON.parse(localStorage.getItem(key));
    return { data: { tenantId, hasMore: false, rows: original ? [{ ...original, creditNumber: 'CN-0100', status: 'unknown' }] : [] } };
  }
  if (name === 'xeroCreditAllocationReconcile') {
    const original = JSON.parse(localStorage.getItem(key));
    if (body.operationId !== original?.operationId || body.reviewFingerprint !== original.reviewFingerprint) throw new Error('Wrong original operation');
    localStorage.removeItem(key);
    return { data: { operationId: body.operationId, status: 'applied' } };
  }
  throw new Error(`Unexpected fixture call ${name}`);
};
createRoot(document.getElementById('root')).render(
  <main className="mx-auto max-w-6xl p-6"><XeroCreditAllocationActions tenantId={tenantId} actorId={actorId} /></main>,
);
