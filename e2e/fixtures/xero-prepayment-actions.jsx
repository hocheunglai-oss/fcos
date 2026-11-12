import { createRoot } from 'react-dom/client';
import { appClient } from '@/api/appClient';
import XeroPrepaymentActions from '@/components/xero/XeroPrepaymentActions';
import '@/index.css';

const tenantId = '10000000-0000-4000-8000-000000000009';
const contactId = '10000000-0000-4000-8000-000000000010';
const stemId = 'a01000000000001AAA';
const sourceId = 'a02000000000001AAA';
const fingerprint = 'a'.repeat(64);
const params = new URLSearchParams(location.search);
const locked = params.has('locked');
let original = locked ? { operationId: '10000000-0000-4000-8000-000000000011', reviewFingerprint: fingerprint } : null;
window.prepaymentFixture = { calls: [] };
appClient.functions.invoke = async (name, body) => {
  window.prepaymentFixture.calls.push({ name, body });
  if (body.tenantId !== tenantId) throw new Error('Unexpected tenant');
  if (name === 'xeroPrepaymentQueue') {
    if (body.stemKey !== 'HK2600100T') throw new Error('Unexpected STEM');
    return { data: { tenantId, stemId, writeEnabled: !locked, rows: [{ sourceId, name: 'Deposit 1', partyName: 'Fixture Buyer',
      action: 'create', date: '2026-09-10', currency: 'HKD', nativeAmount: 780,
      status: original ? 'unknown' : 'ready_for_review', recovery: original }] } };
  }
  if (name === 'xeroPrepaymentContacts') return { data: { tenantId, sourceId, contacts: [{ id: contactId, name: 'Fixture Buyer' }] } };
  if (name === 'xeroPrepaymentPreview') {
    if (body.sourceId !== sourceId || body.stemId !== stemId || body.contactId !== contactId) throw new Error('Review selection changed');
    return { data: { tenantId, sourceId, action: 'create', writeEnabled: !locked, reviewFingerprint: fingerprint, currency: 'HKD', nativeAmount: 780,
      accountingUsd: 97.5, postingDate: '2026-09-10', contactName: 'Fixture Buyer', bankName: 'Fixture Bank', depositAccountCode: 'DEP',
      taxType: 'NONE', policyRevision: 1, cashRemainingNative: 780 } };
  }
  if (name === 'xeroPrepaymentApply') {
    if (original || !body.reviewed || body.reviewFingerprint !== fingerprint) throw new Error('Duplicate or unreviewed operation');
    original = { operationId: body.operationId, reviewFingerprint: body.reviewFingerprint };
    if (params.has('lost')) throw new Error('The response was lost.');
    return { data: { operationId: body.operationId, status: 'applied' } };
  }
  if (name === 'xeroPrepaymentReconcile') {
    if (body.operationId !== original.operationId || body.reviewFingerprint !== original.reviewFingerprint) throw new Error('Wrong original operation');
    return { data: { operationId: body.operationId, status: 'applied' } };
  }
  throw new Error(`Unexpected fixture call ${name}`);
};
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-6"><XeroPrepaymentActions tenantId={tenantId} /></main>);
