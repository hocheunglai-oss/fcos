import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MissingNomB from '@/pages/MissingNomB';
import { appClient } from '@/api/appClient';
import '@/styles/fonts.css';
import '@/index.css';

const liveCheck = new URLSearchParams(window.location.search).get('liveCheck') === '1';
const liveEndpoints = {
  missingNomBList: '/nom-b-live-check/list',
  missingNomBUpload: '/nom-b-live-check/upload',
};

const row = (number, extra = {}) => ({
  nominationId: `fixture-nomination-${number}`,
  stemId: `fixture-stem-${number}`,
  stemName: `STEM-${String(number).padStart(3, '0')}`,
  buyerName: number === 1 ? 'North Star Fuels' : 'Eastern Marine Fuels',
  vesselName: number === 1 ? 'Pacific Endeavour' : `Fixture vessel ${number}`,
  imo: `900000${number}`,
  portName: 'Hong Kong',
  deliveryDate: number === 1 ? '2026-09-18' : null,
  expectedDeliveryDate: number === 1 ? null : '2026-10-05',
  confirmationReference: `BC-${number}`,
  traderName: 'Ada Trader',
  receivedStatus: number === 2 ? '🟢' : '🟡',
  canUpload: number !== 2,
  ...extra,
});

const fixture = {
  user: { id: 'fixture-trader', email: 'ada@example.invalid' },
  rows: [row(1), row(2), row(3)],
  filedIds: new Set(),
  requests: [],
  uploads: [],
  uploadResponses: [],
  deferUpload: false,
  releaseUpload: null,
  listError: false,
};
window.missingNomBFixture = fixture;

appClient.functions.invoke = async (name, body = {}) => {
  if (liveCheck && liveEndpoints[name]) {
    const response = await fetch(liveEndpoints[name], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { data: await response.json() };
  }
  fixture.requests.push({ name, body: structuredClone(body) });
  if (name === 'missingNomBList') {
    if (fixture.listError) return { data: { error: 'Fixture list read failed.' } };
    const search = String(body.search || '').toLowerCase();
    if (search === 'none') return { data: { rows: [], nextCursor: null, asOf: '2026-09-30T04:00:00Z' } };
    if (search === 'skip') return { data: { rows: body.cursor === 'skip-tail' ? [fixture.rows[2]] : [], nextCursor: body.cursor ? null : 'skip-tail', asOf: '2026-09-30T04:00:00Z' } };
    const available = fixture.rows.filter((item) => !fixture.filedIds.has(item.nominationId) && (!search || [item.stemName, item.buyerName, item.vesselName, item.portName, item.confirmationReference].some((value) => value.toLowerCase().includes(search))));
    if (search) return { data: { rows: available, nextCursor: null, asOf: '2026-09-30T04:00:00Z' } };
    return { data: { rows: body.cursor === 'page-2' ? available.slice(2) : available.slice(0, 2), nextCursor: body.cursor || available.length <= 2 ? null : 'page-2', asOf: '2026-09-30T04:00:00Z' } };
  }
  if (name === 'missingNomBUpload') {
    fixture.uploads.push(structuredClone(body));
    if (fixture.deferUpload) await new Promise((resolve) => { fixture.releaseUpload = resolve; });
    const outcome = fixture.uploadResponses.shift() || 'success';
    if (outcome === 'uncertain') return { data: { error: 'Salesforce outcome is still being checked.', code: 'MISSING_NOM_B_UPLOAD_UNCERTAIN' }, meta: { cacheLayer: 'server' } };
    if (outcome === 'rejected') return { data: { error: 'The file contents do not match the filename.', code: 'MISSING_NOM_B_CONTENT_TYPE' }, meta: { cacheLayer: 'server' } };
    if (outcome === 'unverified') return { data: { nominationId: body.nominationId, receivedStatus: '🟢' }, meta: { cacheLayer: 'server' } };
    if (outcome === 'network') return { data: { error: 'Network connection was lost.' }, meta: { cacheLayer: 'network' } };
    fixture.filedIds.add(body.nominationId);
    return { data: { verified: true, nominationId: body.nominationId, stemId: 'fixture-stem-1', contentDocumentId: 'fixture-document-1', contentVersionId: 'fixture-version-1', receivedStatus: '🟢' } };
  }
  if (name === 'salesforceStemDetail') return { data: { record: { Id: body.stemId, Name: 'Opened fixture STEM', Vessel_Name__c: 'Pacific Endeavour' }, lineItems: [], extraCosts: [] } };
  if (name === 'salesforceStemDocuments') return { data: { documents: [] } };
  throw new Error(`Unexpected isolated fixture request: ${name}`);
};

createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/missing-nom-b']}><p className={liveCheck ? 'm-3 rounded-md border border-amber-500 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950' : 'p-3 text-xs'}>{liveCheck ? 'Synthetic DEVEE verification fixture — guarded local DEVEE list and upload calls' : 'Synthetic Missing Nom B fixture — no live provider data'}</p><Routes><Route path="/missing-nom-b" element={<MissingNomB />} /><Route path="/" element={<h1>Dashboard fixture</h1>} /></Routes></MemoryRouter>);
