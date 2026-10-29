import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import XeroFinancialSync from '@/components/xero/XeroFinancialSync';
import { appClient } from '@/api/appClient';
import '@/index.css';

let scenario = 'known';
function rate() {
  const now = Date.now();
  return { dayRemaining: 190, observedAt: new Date(now).toISOString(),
    dayResetAt: scenario === 'unknown' ? null : new Date(now + (scenario === 'elapsed' ? -60000 : scenario === 'countdown' ? 4000 : 5400000)).toISOString() };
}
appClient.functions.invoke = async (name) => {
  if (name === 'xeroFinancialMappingsGet') return { data: { productMappings: [], bankMappings: [] } };
  if (name === 'xeroFinancialSyncLatest') return { data: { preview: {
    run: { id: 'synthetic', status: 'ready_for_review', createdAt: new Date().toISOString(), rateLimit: rate() },
    rows: Array.from({ length: 101 }, (_, index) => ({
      id: `document-${index}`, documentNumber: `DEMO-${String(index + 1).padStart(3, '0')}`,
      documentKind: 'buyer_invoice', accountName: 'Synthetic Buyer', stemName: 'TEST STEM',
      invoiceDate: '2026-09-22', dueDate: '2026-10-22', currency: 'USD', total: 12500,
      action: 'create', status: 'blocked', blockers: ['Synthetic verification only'],
    })), products: [], payments: { rows: [{ salesforcePaymentId: 'payment-demo',
      salesforcePaymentName: 'DEMO-PAYMENT', type: 'buyer', paymentDate: '2026-09-22',
      bank: 'DBS', currency: 'USD', amount: 12500, action: 'payment_apply', status: 'blocked',
      blockers: ['Synthetic verification only'],
    }] },
  } } };
  return { data: { error: 'Synthetic daily reserve stop; saved check retained.', code: 'XERO_FINANCIAL_DAILY_RESERVE', details: { rateLimit: rate() } } };
};
function Fixture() {
  const [revision, setRevision] = useState(0);
  const [language, setLanguage] = useState('en');
  return <main className="h-dvh overflow-auto p-4"><h1 className="text-xl font-semibold">Xero allowance verification</h1><p>Synthetic data · no provider calls</p>
    <nav className="my-4 flex flex-wrap gap-3">{['known', 'unknown', 'elapsed', 'countdown'].map((value) => <button key={value} className="rounded border px-3 py-1" onClick={() => { scenario = value; setRevision((old) => old + 1); }}>{value}</button>)}<button className="rounded border px-3 py-1" onClick={() => setLanguage((old) => old === 'en' ? 'zh-Hant' : 'en')}>English / 中文</button></nav>
    <XeroFinancialSync key={revision} language={language} portalStatus={{ xero: { connected: true, scopeFlags: { invoices: true, contacts: true, settingsRead: true, paymentsRead: true } } }} />
  </main>;
}
const root = createRoot(document.getElementById('root'));
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
