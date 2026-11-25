import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import DashboardSettings from '@/pages/DashboardSettings';
import { appClient } from '@/api/appClient';
import '@/index.css';

// Opt-in local fixture: render the actual Dashboard with all provider calls stubbed.
const selectionFixture = new URLSearchParams(window.location.search).has('selection');
window.dashboardRecovery = { requests: [], mode: 'fail', pending: [], blocked: {}, holdExport: false };

const exportRevision = '2026-11-24T00:00:00.000Z';
const utf8 = new TextEncoder();
function rowFor(desk, suffix = 'ordinary') {
  return { id: `${desk}-${suffix}`, name: `STEM ${desk} ${suffix}`, currency: 'USD', account: { id: `${desk}-Buyer`, name: `Buyer ${desk}` }, exportRevision };
}

async function selectionResponse(name, body) {
  const desk = (body.filterSpec || body).filters?.koreaDeskMode === 'include' ? 'B' : 'A';
  const rows = [rowFor(desk, body.cursor ? 'second' : body.search || 'ordinary')];
  if (name === 'dashboardSummary') return { matchingCount: 1, financials: [{ currency: 'USD', netPnl: desk === 'A' ? 101 : 202 }] };
  if (name === 'dashboardStemList' && (body.exportSnapshot || body.pageSize > 50)) {
    const hash = await crypto.subtle.digest('SHA-256', utf8.encode(JSON.stringify([rows[0].id, exportRevision])));
    const exportSelectionDigest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { stems: rows, matchingCount: 1, nextCursor: null, exportSelectionDigest };
  }
  if (name === 'dashboardStemList') return { stems: rows, matchingCount: 51, pageSize: body.pageSize, sort: body.sort, nextCursor: body.cursor ? null : 'cursor-2' };
  if (name === 'dashboardAnalytics') return { rankings: { accountsByNetPnl: [{ accountId: `${desk}-ranked`, name: `Ranked buyer ${desk}`, netPnl: 1 }] } };
  if (name === 'dashboardAccountCreditDirectory') {
    return { accounts: [{ entityType: 'account', entityId: `${desk}-${body.direction}`, entityKey: `${desk}-${body.direction}`, name: `Directory ${desk} ${body.direction}`, roles: ['buyer'] }] };
  }
  if (name === 'dashboardAccountExposureBatch') return { exposures: [] };
  if (name === 'dashboardAiSearch') return { aiSearch: { status: 'ready', matchedCount: 1 }, stems: [rowFor(desk, body.prompt)] };
  if (name === 'salesforceStemDetail') return { record: { Id: body.stemId, Name: `Detail ${body.stemId}` } };
  if (name === 'salesforceStemDocuments') return { documents: [] };
  if (name === 'dashboardFilterOptions') return { options: [] };
  throw new Error(`Unexpected selection fixture request: ${name}`);
}
appClient.functions.invoke = async (name, body, options = {}) => {
  const fixture = window.dashboardRecovery;
  if (selectionFixture) {
    const scope = (body.filterSpec || body).filters?.koreaDeskMode === 'include' ? 'B' : 'A';
    const request = { name, body: structuredClone(body), scope, force: Boolean(options.force), signal: options.signal };
    fixture.requests.push(request);
    if (((body.exportSnapshot || body.pageSize > 50) && fixture.holdExport) || fixture.blocked[`${name}:${scope}`]) {
      // Intentionally ignore AbortSignal here to test late provider settlements.
      return new Promise((resolve, reject) => fixture.pending.push({
        ...request,
        resolve: async () => resolve({ data: await selectionResponse(name, body) }),
        reject: () => reject(new Error(`${name} unavailable for desk ${scope}`)),
      }));
    }
    return { data: await selectionResponse(name, body) };
  }
  fixture.requests.push({ name, body: structuredClone(body), force: Boolean(options.force) });
  if (name === 'dashboardSummary') return { data: { matchingCount: 0, accountCount: 0, disputedCount: 0, financials: [] } };
  if (name === 'dashboardStemList') return { data: { stems: [], matchingCount: 0 } };
  if (name === 'dashboardFilterOptions') return { data: { options: [] } };
  if (name === 'dashboardAnalytics') {
    if (fixture.mode === 'pending') return new Promise((resolve, reject) => fixture.pending.push({ resolve, reject }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (fixture.mode === 'fail') throw new Error('Salesforce is temporarily unavailable.');
    return { data: { rankings: { accountsByNetPnl: [{ accountId: 'test', name: 'Recovered buyer', currency: 'USD', netPnl: 100 }] } } };
  }
  throw new Error(`Unexpected fixture request: ${name}`);
};
createRoot(document.getElementById('root')).render(<StrictMode><MemoryRouter><AuthProvider><DashboardSettings/></AuthProvider></MemoryRouter></StrictMode>);
